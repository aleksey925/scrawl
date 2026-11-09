import type { EditorView } from '@codemirror/view';
import {
  ActionIcon,
  Alert,
  Button,
  Group,
  Tabs,
  Text,
} from '@mantine/core';
import { useDebouncedValue, useMediaQuery } from '@mantine/hooks';
import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from 'react';
import { useBlocker, useLocation, useNavigate } from 'react-router';

import { api, installUnauthorizedHandler } from '../api/client';
import { ApiError, type ApiConflict } from '../api/errors';
import { errorText } from '../api/useApi';
import { countOf } from '../components/formats';
import { Segmented, type SegmentedOption } from '../components/Segmented';
import {
  IconBraces,
  IconColumns,
  IconDiff,
  IconEye,
  IconPhoto,
  IconTextWrap,
  IconTextWrapDisabled,
} from '../icons';
import { documentUrl, editUrl, isMarkdown } from '../paths';
import { holdPosition, interactionEvents } from '../reader/position';
import { useNav } from '../shell/NavContext';
import { basenameOf } from '../shell/naming';
import { PageActions } from '../shell/ShellSlots';
import { modChord } from '../shell/shortcuts';
import { useMutationState } from '../shell/useMutationState';
import { layout } from '../theme';
import { showToast } from '../toast';

import { ChangesPane } from './ChangesPane';
import { PreviewPane } from './PreviewPane';
import { SourceEditor, type DroppedFiles, type EditorKind } from './SourceEditor';
import { Splitter } from './Splitter';
import type { TableMenuProps } from './TableMenu';
import { Toolbar } from './Toolbar';
import {
  captureFromPane,
  isReadingAnchor,
  paneTopForAnchor,
  rememberAnchor,
  recallAnchor,
  type ReadingAnchor,
} from './anchor';
import { captureFromSource, holdAnchorAtTop } from './cmAnchor';
import { codeLanguageOf } from './codeLanguages';
import { tocAttempts, uploadAccept } from './constants';
import { confirmLeave, openConflict, openSessionExpired } from './dialogs';
import { formatMarkdown, replaceText, warmFormatter } from './format';
import classes from './Editor.module.css';
import { lineBreakOf, toEditorText, withLineBreak } from './lineBreaks';
import { runMarkdownAction, type MarkdownAction } from './markdownActions';
import { createPaneSync } from './paneSync';
import { insertTable, runTableEdit, tableEditsAtCursor } from './table';
import { tocBlock, writeToc, writeTocInText } from './toc';
import { useChanges } from './useChanges';
import { useDraft } from './useDraft';
import { isLayoutMode, useEditorLayout, type LayoutMode } from './useLayoutMode';
import { useLineWrap } from './useLineWrap';
import { usePreview } from './usePreview';
import { useUploads } from './useUploads';

export interface EditorScreenProps {
  path: string;
  initialContent: string;
  initialRev: string;
  isNew: boolean;
  readOnly: boolean;
  formatOnSave: boolean;
}

const modeOptions: SegmentedOption<LayoutMode>[] = [
  { value: 'source', icon: IconBraces, label: 'Source' },
  { value: 'split', icon: IconColumns, label: 'Split' },
  { value: 'preview', icon: IconEye, label: 'Preview' },
  { value: 'changes', icon: IconDiff, label: 'Changes' },
];

type SaveState = 'saving' | 'uploading' | 'dirty' | 'new' | 'saved';

const saveStateText: Record<SaveState, string> = {
  saving: 'Saving',
  uploading: 'Waiting for the upload',
  dirty: 'Unsaved changes',
  new: 'New note',
  saved: 'Saved',
};

const dottedTextNames: ReadonlySet<string> = new Set(['go.mod', 'go.sum']);

const tocFailed = 'Could not build the contents';

function conflictCopyPath(path: string, stamp: string): string {
  const name = basenameOf(path);
  const dot = name.lastIndexOf('.');
  if (dot <= 0 || dottedTextNames.has(name)) {
    return `${path}.conflict-${stamp}.txt`;
  }
  const ext = name.slice(dot);
  return `${path.slice(0, path.length - ext.length)}.conflict-${stamp}${ext}`;
}

function LineCount({ lines, className }: { lines: number; className: string | undefined }): JSX.Element {
  return (
    <Text data-testid="editor-lines" data-lines={lines} className={className}>
      {countOf(lines, 'line')}
    </Text>
  );
}

export function EditorScreen(props: EditorScreenProps): JSX.Element {
  const { path, initialContent, initialRev, isNew, readOnly } = props;
  const kind: EditorKind = isMarkdown(path) ? 'markdown' : 'text';
  const fileName = basenameOf(path);
  const formattable = !readOnly && kind === 'markdown';
  const formatOnSave = props.formatOnSave && formattable;
  const lineBreak = formatOnSave ? '\n' : lineBreakOf(initialContent);
  const editorText = useMemo(() => toEditorText(initialContent), [initialContent]);
  const navigate = useNavigate();
  const { refreshMe } = useNav();
  const reportMutation = useMutationState();
  const location = useLocation();

  const [content, setContent] = useState(editorText);
  const [saved, setSaved] = useState(editorText);
  const [rev, setRev] = useState(initialRev);
  const [saving, setSaving] = useState(false);
  const [view, setView] = useState<EditorView | undefined>(undefined);

  const dirty = content !== saved;

  const viewRef = useRef<EditorView | undefined>(undefined);
  const contentRef = useRef(content);
  const revRef = useRef(rev);
  const savingRef = useRef(false);
  const leavingRef = useRef(false);
  const leaderRef = useRef<'source' | 'preview' | undefined>(undefined);
  const promptedRef = useRef(false);
  const previewRef = useRef<HTMLDivElement>(null);
  const panesRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const arrivedWith = useRef(location.state);
  const leftForChangesRef = useRef<ReadingAnchor | undefined>(undefined);

  contentRef.current = content;
  revRef.current = rev;

  const layoutControl = useEditorLayout();
  const { chosen, choose, split, setSplit, wide } = layoutControl;
  const mode = kind === 'markdown' ? layoutControl.mode : 'source';
  const lineWrap = useLineWrap();
  const touch = useMediaQuery('(hover: none)', false, { getInitialValueInEffect: false }) ?? false;

  const showSource = mode === 'source' || mode === 'split';
  const showPreview = mode === 'preview' || mode === 'split';
  const preview = usePreview(content, path, showPreview);
  const changes = useChanges({ saved, content, path, enabled: mode === 'changes', paused: saving });
  const uploads = useUploads(path, useCallback(() => viewRef.current, []));
  const draft = useDraft({ path, rev, content, dirty, savedContent: editorText });

  const draftRef = useRef(draft);
  draftRef.current = draft;

  const onCreate = useCallback((created: EditorView): void => {
    viewRef.current = created;
    setView(created);
  }, []);

  const liveView = useCallback((): EditorView | undefined => {
    const current = viewRef.current;
    return current?.dom.isConnected === true ? current : undefined;
  }, []);

  const bufferText = useCallback(
    (): string => liveView()?.state.doc.toString() ?? contentRef.current,
    [liveView],
  );

  const putFormatted = useCallback(
    (sent: string, formatted: string, cursor?: number): boolean => {
      if (bufferText() !== sent) {
        return false;
      }
      const current = liveView();
      if (current === undefined) {
        setContent(formatted);
      } else {
        replaceText(current, formatted, cursor);
      }
      return true;
    },
    [bufferText, liveView],
  );

  const formatBuffer = useCallback(async (): Promise<string> => {
    const sent = bufferText();
    const res = await formatMarkdown(sent, liveView()?.state.selection.main.head ?? 0);
    putFormatted(sent, res.text, res.cursor);
    return res.text;
  }, [bufferText, liveView, putFormatted]);

  const format = useCallback((): void => {
    formatBuffer().catch((error: unknown) => {
      showToast('error', { title: 'Could not format the note', message: errorText(error) });
    });
  }, [formatBuffer]);

  const tocAbortRef = useRef<AbortController | undefined>(undefined);

  useEffect(() => () => tocAbortRef.current?.abort(), []);

  const insertToc = useCallback((): void => {
    tocAbortRef.current?.abort();
    const controller = new AbortController();
    tocAbortRef.current = controller;
    const build = (attempt: number): void => {
      const sent = bufferText();
      api.preview({ content: sent, path }, { signal: controller.signal }).then(
        (res) => {
          if (controller.signal.aborted) {
            return;
          }
          if (bufferText() !== sent) {
            if (attempt < tocAttempts) {
              build(attempt + 1);
              return;
            }
            showToast('error', {
              title: tocFailed,
              message: 'The note kept changing. Press the button again.',
            });
            return;
          }
          const block = tocBlock(res.toc);
          if (block === undefined) {
            showToast('warn', { title: 'No headings to list', message: 'The contents lists the headings under the title.' });
            return;
          }
          const current = liveView();
          if (current === undefined) {
            setContent(writeTocInText(sent, viewRef.current?.state.selection.main.head ?? 0, block));
          } else {
            writeToc(current, block);
          }
        },
        (error: unknown) => {
          if (controller.signal.aborted) {
            return;
          }
          showToast('error', { title: tocFailed, message: errorText(error) });
        },
      );
    };
    build(1);
  }, [bufferText, liveView, path]);

  useEffect(() => {
    if (formatOnSave) {
      warmFormatter();
    }
  }, [formatOnSave]);

  const [openedAt, setOpenedAt] = useState<ReadingAnchor | undefined>(undefined);

  const previewPlaced = useRef(false);
  const readerMoved = useRef(false);

  useEffect(() => {
    previewPlaced.current = false;
    readerMoved.current = false;
    const carried = arrivedWith.current;
    const anchor =
      isReadingAnchor(carried) && carried.path === path ? carried : recallAnchor('edit', path);
    if (anchor !== undefined) {
      setOpenedAt(anchor);
    }
  }, [path]);

  useEffect(() => {
    if (view === undefined || openedAt === undefined) {
      return;
    }
    return holdAnchorAtTop(view, openedAt);
  }, [view, openedAt]);

  useEffect(() => {
    const targets = [view?.dom, previewRef.current].filter((el): el is HTMLElement => el != null);
    const moved = (): void => {
      readerMoved.current = true;
    };
    for (const target of targets) {
      for (const name of interactionEvents) {
        target.addEventListener(name, moved, { passive: true, capture: true });
      }
    }
    return () => {
      for (const target of targets) {
        for (const name of interactionEvents) {
          target.removeEventListener(name, moved, { capture: true });
        }
      }
    };
  }, [view, mode]);

  const panes = useMemo(createPaneSync, []);

  useEffect(() => {
    const pane = previewRef.current;
    if (pane === null || openedAt === undefined || previewPlaced.current || preview.html === '') {
      return;
    }
    previewPlaced.current = true;
    return holdPosition(() => {
      const source = liveView();
      const top = mode === 'split' && source !== undefined
        ? panes.paneTop(source, pane)
        : paneTopForAnchor(pane, openedAt);
      if (top !== undefined) {
        pane.scrollTop = top;
      }
    }, pane);
  }, [openedAt, preview.html, mode, liveView, panes]);

  const captureReadingPosition = useCallback((): ReadingAnchor | undefined => {
    const source = liveView();
    const pane = previewRef.current;
    if (openedAt?.path === path && !readerMoved.current) {
      return { ...openedAt, rev: revRef.current };
    }
    if (pane !== null && (source === undefined || leaderRef.current === 'preview')) {
      return captureFromPane(pane, path, revRef.current);
    }
    if (source !== undefined) {
      return captureFromSource(source, path, revRef.current);
    }
    const left = leftForChangesRef.current;
    return left?.path === path ? { ...left, rev: revRef.current } : undefined;
  }, [path, liveView, openedAt]);

  const rememberReadingPosition = useCallback((): ReadingAnchor | undefined => {
    const anchor = captureReadingPosition();
    if (anchor !== undefined) {
      rememberAnchor('view', anchor);
    }
    return anchor;
  }, [captureReadingPosition]);

  const chooseMode = useCallback(
    (next: LayoutMode): void => {
      if (next === 'changes' && mode !== 'changes') {
        leftForChangesRef.current = captureReadingPosition();
      }
      choose(next);
    },
    [captureReadingPosition, choose, mode],
  );

  const syncFromSource = useCallback((): void => {
    const current = viewRef.current;
    const pane = previewRef.current;
    if (leaderRef.current !== 'source' || current === undefined || pane === null) {
      return;
    }
    pane.scrollTop = panes.paneTop(current, pane);
  }, [panes]);

  const syncFromPreview = useCallback((): void => {
    const current = viewRef.current;
    const pane = previewRef.current;
    if (leaderRef.current !== 'preview' || current === undefined || pane === null) {
      return;
    }
    current.scrollDOM.scrollTop = panes.sourceTop(current, pane);
  }, [panes]);

  useEffect(() => {
    const pane = previewRef.current;
    if (view === undefined || mode !== 'split' || pane === null) {
      return;
    }
    const scroller = view.scrollDOM;
    const takeSource = (): void => {
      leaderRef.current = 'source';
    };
    const takePreview = (): void => {
      leaderRef.current = 'preview';
    };

    scroller.addEventListener('scroll', syncFromSource, { passive: true });
    pane.addEventListener('scroll', syncFromPreview, { passive: true });
    for (const name of interactionEvents) {
      scroller.addEventListener(name, takeSource, { passive: true, capture: true });
      pane.addEventListener(name, takePreview, { passive: true, capture: true });
    }
    return () => {
      scroller.removeEventListener('scroll', syncFromSource);
      pane.removeEventListener('scroll', syncFromPreview);
      for (const name of interactionEvents) {
        scroller.removeEventListener(name, takeSource, { capture: true });
        pane.removeEventListener(name, takePreview, { capture: true });
      }
    };
  }, [view, mode, syncFromSource, syncFromPreview, preview.html]);

  useEffect(() => installUnauthorizedHandler('screen', () => draftRef.current.flush()), []);

  useEffect(() => {
    if (!dirty) {
      return;
    }
    const warn = (event: BeforeUnloadEvent): void => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const blocker = useBlocker(
    useCallback(
      ({ currentLocation, nextLocation }) =>
        dirty && !leavingRef.current && currentLocation.pathname !== nextLocation.pathname,
      [dirty],
    ),
  );

  useEffect(() => {
    if (blocker.state !== 'blocked' || promptedRef.current) {
      return;
    }
    promptedRef.current = true;
    void confirmLeave().then((leave) => {
      promptedRef.current = false;
      if (leave) {
        draftRef.current.flush();
        blocker.proceed();
      } else {
        blocker.reset();
      }
    });
  }, [blocker]);

  const markSaved = useCallback((stored: string, nextRev: string, shown: boolean): void => {
    setSaved(stored);
    setRev(nextRev);
    if (shown) {
      draftRef.current.clear();
    }
  }, []);

  const saveCopy = useCallback(async (): Promise<void> => {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const copyPath = conflictCopyPath(path, stamp);
    const sent = contentRef.current;
    try {
      reportMutation(
        await api.saveFile(copyPath, { content: withLineBreak(sent, lineBreak), rev: '' }),
        'Saved as a copy',
      );
      setSaved(sent);
      draftRef.current.clear();
      leavingRef.current = true;
      await navigate(editUrl(copyPath));
    } catch (error: unknown) {
      showToast('error', { message: errorText(error) });
    }
  }, [lineBreak, navigate, path, reportMutation]);

  const save = useCallback(
    async (withRev?: string): Promise<boolean> => {
      if (savingRef.current || readOnly) {
        return false;
      }
      savingRef.current = true;
      setSaving(true);
      rememberReadingPosition();
      let sent = bufferText();
      try {
        await uploads.wait();
        sent = bufferText();
        let formatted = false;
        if (formatOnSave) {
          try {
            sent = await formatBuffer();
            formatted = true;
          } catch {
            sent = bufferText();
          }
        }
        draftRef.current.flush();
        const res = await api.saveFile(path, {
          content: withLineBreak(sent, lineBreak),
          rev: withRev ?? revRef.current,
          formatted,
        });
        const stored = res.content === undefined ? undefined : toEditorText(res.content);
        const shown = stored === undefined ? bufferText() === sent : putFormatted(sent, stored);
        markSaved(stored ?? sent, res.rev, shown);
        if (res.format_failed === true) {
          showToast('warn', {
            title: 'Saved without formatting',
            message: 'Prettier could not format this note, so it is stored as written.',
          });
        }
        reportMutation(res, 'Saved');
        return shown;
      } catch (error: unknown) {
        if (error instanceof ApiError && (error.status === 412 || error.status === 409)) {
          const current: ApiConflict | undefined =
            error.conflict ?? (await api.file(path).catch(() => undefined));
          if (current === undefined) {
            showToast('error', { message: errorText(error) });
            return false;
          }
          const theirs = toEditorText(current.content);
          if (theirs === sent) {
            const shown = bufferText() === sent;
            markSaved(sent, current.rev, shown);
            showToast('ok', { message: 'Saved' });
            refreshMe();
            return shown;
          }
          openConflict({
            mine: sent,
            theirs,
            onOverwrite: () => void save(current.rev),
            onCopy: () => void saveCopy(),
          });
          return false;
        }
        if (error instanceof ApiError && error.status === 401) {
          draftRef.current.flush();
          openSessionExpired();
          return false;
        }
        showToast('error', { message: errorText(error) });
        return false;
      } finally {
        savingRef.current = false;
        setSaving(false);
      }
    },
    [
      bufferText,
      formatBuffer,
      formatOnSave,
      lineBreak,
      markSaved,
      path,
      putFormatted,
      readOnly,
      refreshMe,
      rememberReadingPosition,
      reportMutation,
      saveCopy,
      uploads,
    ],
  );

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (!modChord(event, 's')) {
        return;
      }
      event.preventDefault();
      void save();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [save]);

  useEffect(() => {
    if (!formattable) {
      return;
    }
    const onKey = (event: KeyboardEvent): void => {
      if (!event.shiftKey || !event.altKey || event.metaKey || event.ctrlKey || event.code !== 'KeyF') {
        return;
      }
      event.preventDefault();
      format();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [format, formattable]);

  const leave = useCallback((): void => {
    const anchor = rememberReadingPosition();
    void navigate(documentUrl(path), { state: anchor });
  }, [navigate, path, rememberReadingPosition]);

  const saveAndLeave = useCallback(async (): Promise<void> => {
    if (dirty || revRef.current === '') {
      if (!(await save())) {
        return;
      }
      leavingRef.current = true;
    }
    leave();
  }, [dirty, leave, save]);

  const onAction = useCallback((action: MarkdownAction): void => {
    const current = viewRef.current;
    if (current !== undefined) {
      runMarkdownAction(current, action);
    }
  }, []);

  const tableMenu = useMemo<TableMenuProps>(
    () => ({
      editsAtCursor: () => {
        const current = viewRef.current;
        return current === undefined ? undefined : tableEditsAtCursor(current.state);
      },
      onEdit: (edit) => {
        const current = viewRef.current;
        if (current !== undefined) {
          runTableEdit(current, edit);
        }
      },
      onInsert: (size) => {
        const current = viewRef.current;
        if (current !== undefined) {
          insertTable(current, size);
        }
      },
    }),
    [],
  );

  const onFiles = useCallback(
    ({ files, at }: DroppedFiles): void => uploads.upload(files, at),
    [uploads],
  );

  const dragSplit = useCallback(
    (clientX: number): void => {
      const box = panesRef.current?.getBoundingClientRect();
      if (box !== undefined && box.width > 0) {
        setSplit((clientX - box.left) / box.width);
      }
    },
    [setSplit],
  );

  const nudgeSplit = useCallback(
    (direction: -1 | 1): void => {
      const width = panesRef.current?.getBoundingClientRect().width ?? 0;
      if (width > 0) {
        setSplit(split + (direction * 40) / width);
      }
    },
    [setSplit, split],
  );

  const [countable] = useDebouncedValue(content, 300);
  const lines = useMemo(() => countable.split('\n').length, [countable]);

  const saveState: SaveState = saving
    ? 'saving'
    : uploads.pending > 0
      ? 'uploading'
      : dirty
        ? 'dirty'
        : isNew
          ? 'new'
          : 'saved';

  const sourceStyle = mode === 'split' ? { flex: `0 0 ${split * 100}%` } : undefined;
  const previewStyle = mode === 'split' ? { flex: '1 1 0' } : undefined;

  return (
    <div data-testid="editor" data-kind={kind} className={classes.screen}>
      <PageActions>
        <Text
          data-testid="editor-status"
          data-dirty={dirty ? 'true' : 'false'}
          data-state={saveState}
          className={classes.status}
          hidden={!wide}
          aria-live="polite"
        >
          {saveState === 'new' && kind === 'text' ? 'New file' : saveStateText[saveState]}
        </Text>
        {wide && kind === 'markdown' && (
          <Segmented
            data-testid="editor-layout-mode"
            data-mode={chosen}
            size="xs"
            value={chosen}
            onChange={chooseMode}
            aria-label="Editor layout"
            classNames={{ root: classes.modes, label: classes.mode }}
            options={modeOptions}
            compact
          />
        )}
        <Button data-testid="editor-cancel" size="sm" variant="subtle" color="gray" className={classes.cancel} onClick={leave}>
          Cancel
        </Button>
        {!readOnly && (
          <Button data-testid="editor-save" size="sm" className={classes.save} loading={saving} onClick={() => void saveAndLeave()}>
            Save
          </Button>
        )}
      </PageActions>

      {(readOnly || draft.offered !== undefined) && (
        <div className={classes.notices}>
          {readOnly && (
            <Alert data-testid="editor-readonly" color="yellow" variant="light">
              This server is read-only. You can read the source here, but it cannot be saved.
            </Alert>
          )}

          {draft.offered !== undefined && (
            <Alert
              data-testid="editor-draft"
              data-stale={draft.stale ? 'true' : 'false'}
              color="yellow"
              variant="light"
              title="An unsaved draft was found"
            >
              <Group justify="space-between" wrap="wrap" gap="sm">
                <Text size="sm">
                  {`Written ${new Date(draft.offered.at).toLocaleString()}`}
                  {draft.stale ? ', against an older version of this page.' : '.'}
                </Text>
                <Group gap="xs">
                  <Button
                    data-testid="editor-draft-restore"
                    size="xs"
                    variant="default"
                    onClick={() => {
                      const current = viewRef.current;
                      const text = draft.offered?.content ?? '';
                      if (current !== undefined) {
                        current.dispatch({
                          changes: { from: 0, to: current.state.doc.length, insert: text },
                        });
                      } else {
                        setContent(text);
                      }
                      draft.dismiss();
                    }}
                  >
                    Restore
                  </Button>
                  <Button
                    data-testid="editor-draft-discard"
                    size="xs"
                    variant="subtle"
                    color="gray"
                    onClick={draft.discard}
                  >
                    Discard
                  </Button>
                </Group>
              </Group>
            </Alert>
          )}
        </div>
      )}

      {!wide && kind === 'markdown' && (
        <Tabs
          data-testid="editor-tabs"
          value={mode}
          onChange={(value) => chooseMode(isLayoutMode(value) ? value : 'source')}
        >
          <Tabs.List grow>
            <Tabs.Tab data-testid="editor-tab-source" value="source" h={layout.tapTarget}>
              Text
            </Tabs.Tab>
            <Tabs.Tab data-testid="editor-tab-preview" value="preview" h={layout.tapTarget}>
              Preview
            </Tabs.Tab>
            <Tabs.Tab data-testid="editor-tab-changes" value="changes" h={layout.tapTarget}>
              Changes
            </Tabs.Tab>
          </Tabs.List>
        </Tabs>
      )}

      <div data-testid="editor-panes" data-mode={mode} className={classes.panes} ref={panesRef}>
        {showSource && (
          <div className={classes.pane} style={sourceStyle}>
            <div className={classes.paneHead}>
              {mode === 'split' && <span className={classes.paneLabel}>Source</span>}
              {kind === 'text' && (
                <span data-testid="editor-language" className={classes.paneLabel}>
                  {codeLanguageOf(fileName)?.name ?? 'Plain text'}
                </span>
              )}
              {!readOnly && kind === 'markdown' && (
                <Toolbar
                  onAction={onAction}
                  onPickImage={() => fileRef.current?.click()}
                  onToc={insertToc}
                  tableMenu={tableMenu}
                  onFormat={formattable ? format : undefined}
                />
              )}
              <div className={classes.paneTools}>
                {uploads.pending > 0 && (
                  <ActionIcon
                    data-testid="editor-upload-pending"
                    data-pending={uploads.pending}
                    className={classes.tool}
                    variant="subtle"
                    color="gray"
                    loading
                    aria-label="Uploading"
                  >
                    <IconPhoto size={layout.iconSizeSmall} />
                  </ActionIcon>
                )}
                {wide && (
                  <LineCount lines={lines} className={classes.lines} />
                )}
                <ActionIcon
                  data-testid="editor-wrap"
                  className={classes.tool}
                  variant="subtle"
                  color="gray"
                  aria-label="Wrap long lines"
                  aria-pressed={lineWrap.wrap}
                  title="Wrap long lines"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={lineWrap.toggle}
                >
                  {lineWrap.wrap ? (
                    <IconTextWrap size={layout.iconSizeSmall} />
                  ) : (
                    <IconTextWrapDisabled size={layout.iconSizeSmall} />
                  )}
                </ActionIcon>
              </div>
            </div>
            <SourceEditor
              kind={kind}
              name={fileName}
              value={content}
              readOnly={readOnly}
              autoFocus={!touch}
              wrap={lineWrap.wrap}
              onChange={setContent}
              onCreate={onCreate}
              onFiles={kind === 'markdown' ? onFiles : undefined}
            />
          </div>
        )}
        {mode === 'split' && <Splitter onDrag={dragSplit} onNudge={nudgeSplit} />}
        {showPreview && (
          <div className={classes.pane} style={previewStyle}>
            {mode === 'split' && (
              <div className={classes.paneHead}>
                <span className={classes.paneLabel}>Preview</span>
              </div>
            )}
            <PreviewPane
              html={preview.html}
              notice={preview.notice}
              busy={preview.busy}
              scrollRef={previewRef}
              alone={mode === 'preview'}
              empty={content.trim() === ''}
            />
          </div>
        )}
        {mode === 'changes' && (
          <ChangesPane changes={changes} layout={wide ? 'split' : 'unified'} />
        )}
      </div>

      {!wide && (
        <LineCount lines={lines} className={classes.footLines} />
      )}

      <input
        ref={fileRef}
        data-testid="editor-upload-input"
        type="file"
        accept={uploadAccept}
        multiple
        hidden
        onChange={(event) => {
          uploads.upload(Array.from(event.currentTarget.files ?? []));
          event.currentTarget.value = '';
        }}
      />
    </div>
  );
}
