import type { EditorView } from '@codemirror/view';
import {
  ActionIcon,
  Alert,
  Button,
  Center,
  Group,
  SegmentedControl,
  Tabs,
  Text,
  VisuallyHidden,
} from '@mantine/core';
import { useDebouncedValue, useMediaQuery } from '@mantine/hooks';
import {
  IconColumns2,
  IconDeviceFloppy,
  IconEye,
  IconFileText,
  IconPhoto,
  IconX,
} from '@tabler/icons-react';
import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from 'react';
import { useBlocker, useLocation, useNavigate } from 'react-router';

import { ApiError, api, installUnauthorizedHandler, type ApiConflict } from '../api/client';
import { errorText } from '../api/useApi';
import { documentUrl, editUrl, isMarkdown } from '../paths';
import { useNav } from '../shell/NavContext';
import { PageActions } from '../shell/ShellSlots';
import { TopbarAction } from '../shell/TopbarAction';
import { useMutationState } from '../shell/useMutationState';
import { layout } from '../theme';
import { showToast } from '../toast';

import { PreviewPane } from './PreviewPane';
import { SourceEditor, type DroppedFiles } from './SourceEditor';
import { Splitter } from './Splitter';
import { Toolbar } from './Toolbar';
import {
  holdPosition,
  interactionEvents,
  isReadingAnchor,
  lineAtFraction,
  paneTopForLine,
  rememberAnchor,
  recallAnchor,
  type ReadingAnchor,
} from './anchor';
import { firstVisibleLine, holdLineAtReading } from './cmAnchor';
import { uploadAccept } from './constants';
import { confirmLeave, openConflict, openSessionExpired } from './dialogs';
import { replaceText } from './format';
import classes from './Editor.module.css';
import { runMarkdownAction, type MarkdownAction } from './markdownActions';
import { createPaneSync } from './paneSync';
import { useDraft } from './useDraft';
import { useEditorLayout, type LayoutMode } from './useLayoutMode';
import { usePreview } from './usePreview';
import { useUploads } from './useUploads';

export interface EditorScreenProps {
  path: string;
  initialContent: string;
  initialRev: string;
  isNew: boolean;
  readOnly: boolean;
}

const modeOptions = [
  { value: 'source', icon: IconFileText, label: 'Source only' },
  { value: 'split', icon: IconColumns2, label: 'Split view' },
  { value: 'preview', icon: IconEye, label: 'Preview only' },
] as const;

type SaveState = 'saving' | 'uploading' | 'dirty' | 'new' | 'saved';

const saveStateText: Record<SaveState, string> = {
  saving: 'Saving',
  uploading: 'Waiting for the upload',
  dirty: 'Unsaved changes',
  new: 'New page',
  saved: 'Saved',
};

export function EditorScreen(props: EditorScreenProps): JSX.Element {
  const { path, initialContent, initialRev, isNew, readOnly } = props;
  const formattable = !readOnly && isMarkdown(path);
  const navigate = useNavigate();
  const { refreshMe } = useNav();
  const reportMutation = useMutationState();
  const location = useLocation();

  const [content, setContent] = useState(initialContent);
  const [saved, setSaved] = useState(initialContent);
  const [rev, setRev] = useState(initialRev);
  const [saving, setSaving] = useState(false);
  const [view, setView] = useState<EditorView | undefined>(undefined);
  const [formatting, setFormatting] = useState(false);

  const dirty = content !== saved;

  const viewRef = useRef<EditorView | undefined>(undefined);
  const contentRef = useRef(content);
  const revRef = useRef(rev);
  const savingRef = useRef(false);
  const formattingRef = useRef(false);
  const leavingRef = useRef(false);
  const leaderRef = useRef<'source' | 'preview' | undefined>(undefined);
  const promptedRef = useRef(false);
  const previewRef = useRef<HTMLDivElement>(null);
  const panesRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const arrivedWith = useRef(location.state);

  contentRef.current = content;
  revRef.current = rev;

  const { mode, chosen, choose, split, setSplit, wide } = useEditorLayout();
  const touch = useMediaQuery('(hover: none)', false, { getInitialValueInEffect: false }) ?? false;

  const preview = usePreview(content, path, mode !== 'source');
  const uploads = useUploads(path, useCallback(() => viewRef.current, []));
  const draft = useDraft({ path, rev, content, dirty, savedContent: initialContent });

  const draftRef = useRef(draft);
  draftRef.current = draft;

  const onCreate = useCallback((created: EditorView): void => {
    viewRef.current = created;
    setView(created);
  }, []);

  // a pane that was put away leaves its view in the ref, already destroyed
  const liveView = useCallback((): EditorView | undefined => {
    const current = viewRef.current;
    return current?.dom.isConnected === true ? current : undefined;
  }, []);

  // the editor and not the state: a change dispatched from a promise is in
  // the editor at once and in the state only after the next render
  const bufferText = useCallback(
    (): string => liveView()?.state.doc.toString() ?? contentRef.current,
    [liveView],
  );

  // putFormatted shows what the server made of `sent` and says whether it did.
  // The answer took a round trip, and what was typed meanwhile is not in it:
  // putting it in the editor then would drop those keys.
  const putFormatted = useCallback(
    (sent: string, formatted: string, cursor: number | undefined): boolean => {
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

  const format = useCallback((): void => {
    // a held key repeats, and every request would take a worker to the end
    if (formattingRef.current) {
      return;
    }
    formattingRef.current = true;
    setFormatting(true);
    const sent = bufferText();
    api
      .format({ content: sent, cursor: liveView()?.state.selection.main.head ?? 0 })
      .then((res) => putFormatted(sent, res.content, res.cursor))
      .catch((error: unknown) => {
        showToast('error', { title: 'Could not format the note', message: errorText(error) });
      })
      .finally(() => {
        formattingRef.current = false;
        setFormatting(false);
      });
  }, [bufferText, liveView, putFormatted]);

  const [openedAt, setOpenedAt] = useState<ReadingAnchor | undefined>(undefined);

  const previewPlaced = useRef(false);

  useEffect(() => {
    previewPlaced.current = false;
    const carried = arrivedWith.current;
    const anchor =
      isReadingAnchor(carried) && carried.path === path ? carried : recallAnchor('edit', path);
    if (anchor !== undefined) {
      setOpenedAt(anchor);
    }
  }, [path]);

  const openedLine =
    openedAt === undefined ? undefined : lineAtFraction(openedAt, openedAt.fractionWithinBlock);

  useEffect(() => {
    if (view === undefined || openedLine === undefined) {
      return;
    }
    return holdLineAtReading(view, openedLine);
  }, [view, openedLine]);

  // the html arrives after the editor, so the pane waits for it. It is placed
  // once and never again: every keystroke renders the preview afresh, and a
  // second placing would drag the writer back to where they came in
  useEffect(() => {
    const pane = previewRef.current;
    if (pane === null || openedLine === undefined || previewPlaced.current || preview.html === '') {
      return;
    }
    previewPlaced.current = true;
    return holdPosition(() => {
      const top = paneTopForLine(pane, openedLine);
      if (top !== undefined) {
        pane.scrollTop = top;
      }
    }, pane);
  }, [openedLine, preview.html, mode]);

  const rememberReadingPosition = useCallback((): ReadingAnchor | undefined => {
    const current = viewRef.current;
    if (current === undefined) {
      return undefined;
    }
    const line = firstVisibleLine(current);
    const anchor: ReadingAnchor = {
      path,
      rev: revRef.current,
      startLine: line,
      endLine: line,
      fractionWithinBlock: 0,
    };
    rememberAnchor('view', anchor);
    return anchor;
  }, [path]);

  const panes = useMemo(createPaneSync, []);

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

  // Only the pane the reader is working in moves the other one. A scroll event
  // says an element moved and not who moved it, so without an owner the two
  // panes answer each other's corrections forever: each one lands a little off
  // where the other put it, and the page shakes under a finger that is already
  // scrolling. Timing cannot settle this - the echo arrives a frame later, on
  // the far side of any flag cleared in a rendering callback.
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

  // the shell answers a 401 by navigating to the login page, which would
  // unmount this editor and take the unsaved buffer with it
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

  // `shown` is whether the buffer holds what was stored, asked of the caller
  // and not of the state: a buffer replaced a line ago is not in it yet
  const markSaved = useCallback((stored: string, nextRev: string, shown: boolean): void => {
    setSaved(stored);
    setRev(nextRev);
    if (shown) {
      draftRef.current.clear();
    }
  }, []);

  const saveCopy = useCallback(async (): Promise<void> => {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const copyPath = `${path.replace(/\.md$/, '')}.conflict-${stamp}.md`;
    const sent = contentRef.current;
    try {
      // a conflict copy is a save like any other and its push can fail like any
      // other, so the response goes to the hook rather than being discarded
      // before the navigation. The toast and the refresh both survive it:
      // showToast is module level and NavProvider sits above the router.
      reportMutation(await api.saveFile(copyPath, { content: sent, rev: '' }), 'Saved as a copy');
      setSaved(sent);
      draftRef.current.clear();
      leavingRef.current = true;
      await navigate(editUrl(copyPath));
    } catch (error: unknown) {
      showToast('error', { message: errorText(error) });
    }
  }, [navigate, path, reportMutation]);

  const save = useCallback(
    async (withRev?: string): Promise<void> => {
      // a second click would send the same revision again and come back as a
      // conflict for a save that in fact went through
      if (savingRef.current || readOnly) {
        return;
      }
      savingRef.current = true;
      setSaving(true);
      rememberReadingPosition();
      let sent = bufferText();
      try {
        // an upload still in flight has its placeholder sitting in the text,
        // and saving now writes that to disk as the document
        await uploads.wait();
        sent = bufferText();
        draftRef.current.flush();
        const res = await api.saveFile(path, {
          content: sent,
          rev: withRev ?? revRef.current,
          cursor: liveView()?.state.selection.main.head,
        });
        const shown =
          res.content === undefined
            ? bufferText() === sent
            : putFormatted(sent, res.content, res.cursor);
        markSaved(res.content ?? sent, res.rev, shown);
        if (res.format_failed === true) {
          showToast('warn', {
            title: 'Saved without formatting',
            message: 'Prettier could not format this note, so it is stored as written.',
          });
        }
        reportMutation(res, 'Saved');
      } catch (error: unknown) {
        if (error instanceof ApiError && (error.status === 412 || error.status === 409)) {
          const current: ApiConflict | undefined =
            error.conflict ?? (await api.file(path).catch(() => undefined));
          if (current === undefined) {
            showToast('error', { message: errorText(error) });
            return;
          }
          // a response lost on the way back leaves the write done and this
          // editor a revision behind, so the retry collides with its own text
          if (current.content === sent) {
            markSaved(sent, current.rev, bufferText() === sent);
            showToast('ok', { message: 'Saved' });
            // the response that carried the state never arrived, so there is
            // nothing to hand the hook: this is the one successful write with
            // no body of its own
            refreshMe();
            return;
          }
          openConflict({
            mine: sent,
            theirs: current.content,
            onOverwrite: () => void save(current.rev),
            onCopy: () => void saveCopy(),
          });
          return;
        }
        if (error instanceof ApiError && error.status === 401) {
          draftRef.current.flush();
          openSessionExpired();
          return;
        }
        showToast('error', { message: errorText(error) });
      } finally {
        savingRef.current = false;
        setSaving(false);
      }
    },
    [
      bufferText,
      liveView,
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
    // on the document rather than the editor: with the caret in the preview
    // pane this would otherwise be the browser's own save dialog
    const onKey = (event: KeyboardEvent): void => {
      if (!(event.metaKey || event.ctrlKey) || event.shiftKey || event.altKey) {
        return;
      }
      if (event.key.toLowerCase() !== 's') {
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
      // the code and not the key: with option held a mac reports the letter
      // the layout types there, which for this one is "Ï"
      if (!event.shiftKey || !event.altKey || event.metaKey || event.ctrlKey || event.code !== 'KeyF') {
        return;
      }
      event.preventDefault();
      format();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [format, formattable]);

  const cancel = useCallback((): void => {
    const anchor = rememberReadingPosition();
    void navigate(documentUrl(path), { state: anchor });
  }, [navigate, path, rememberReadingPosition]);

  const onAction = useCallback((action: MarkdownAction): void => {
    const current = viewRef.current;
    if (current !== undefined) {
      runMarkdownAction(current, action);
    }
  }, []);

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

  const showSource = mode !== 'preview';
  const showPreview = mode !== 'source';
  const sourceStyle = mode === 'split' ? { flex: `0 0 ${split * 100}%` } : undefined;
  const previewStyle = mode === 'split' ? { flex: '1 1 0' } : undefined;

  return (
    <div data-testid="editor" className={classes.screen}>
      <PageActions>
        {wide && (
          <SegmentedControl
            data-testid="editor-layout-mode"
            data-mode={chosen}
            size="sm"
            value={chosen}
            onChange={(value) => choose(value as LayoutMode)}
            aria-label="Editor layout"
            data={modeOptions.map(({ value, icon: Icon, label }) => ({
              value,
              label: (
                <Center>
                  <Icon size={16} />
                  <VisuallyHidden>{label}</VisuallyHidden>
                </Center>
              ),
            }))}
          />
        )}
        {!readOnly && (
          <Button
            data-testid="editor-save"
            size="sm"
            loading={saving}
            leftSection={<IconDeviceFloppy size={16} />}
            onClick={() => void save()}
          >
            Save
          </Button>
        )}
        <TopbarAction testId="editor-cancel" label="Cancel" icon={IconX} onClick={cancel} />
      </PageActions>

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

      {!wide && (
        <Tabs
          data-testid="editor-tabs"
          value={mode === 'preview' ? 'preview' : 'source'}
          onChange={(value) => choose(value === 'preview' ? 'preview' : 'source')}
        >
          <Tabs.List grow>
            <Tabs.Tab data-testid="editor-tab-source" value="source" h={layout.tapTarget}>
              Text
            </Tabs.Tab>
            <Tabs.Tab data-testid="editor-tab-preview" value="preview" h={layout.tapTarget}>
              Preview
            </Tabs.Tab>
          </Tabs.List>
        </Tabs>
      )}

      {!readOnly && showSource && (
        <Group gap="xs" wrap="nowrap">
          <Toolbar
            onAction={onAction}
            onPickImage={() => fileRef.current?.click()}
            onFormat={formattable ? format : undefined}
            formatting={formatting}
          />
          {uploads.pending > 0 && (
            <ActionIcon
              data-testid="editor-upload-pending"
              data-pending={uploads.pending}
              size={layout.tapTarget}
              variant="subtle"
              color="gray"
              loading
              aria-label="Uploading"
            >
              <IconPhoto size={18} />
            </ActionIcon>
          )}
        </Group>
      )}

      <div data-testid="editor-panes" data-mode={mode} className={classes.panes} ref={panesRef}>
        {showSource && (
          <div className={classes.pane} style={sourceStyle}>
            <SourceEditor
              value={content}
              readOnly={readOnly}
              // on a phone an autofocus opens the keyboard over half the document
              autoFocus={!touch}
              onChange={setContent}
              onCreate={onCreate}
              onFiles={onFiles}
            />
          </div>
        )}
        {mode === 'split' && <Splitter onDrag={dragSplit} onNudge={nudgeSplit} />}
        {showPreview && (
          <div className={classes.pane} style={previewStyle}>
            <PreviewPane
              html={preview.html}
              notice={preview.notice}
              busy={preview.busy}
              scrollRef={previewRef}
              alone={mode === 'preview'}
            />
          </div>
        )}
      </div>

      <Group gap="xs" justify="space-between">
        <Text data-testid="editor-lines" data-lines={lines} size="xs" c="dimmed">
          {`${lines} lines`}
        </Text>
        <Text
          data-testid="editor-status"
          data-dirty={dirty ? 'true' : 'false'}
          data-state={saveState}
          size="xs"
          c="dimmed"
          aria-live="polite"
        >
          {saveStateText[saveState]}
        </Text>
        <Text data-testid="editor-path" size="xs" c="dimmed" truncate>
          {path}
        </Text>
      </Group>

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
