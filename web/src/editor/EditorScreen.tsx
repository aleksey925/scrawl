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

import { api } from '../api/client';
import { errorText } from '../api/useApi';
import { countOf } from '../components/formats';
import { Segmented, type SegmentedOption } from '../components/Segmented';
import { useOffScreen } from '../components/screenMotion';
import {
  IconBraces,
  IconColumns,
  IconDiff,
  IconEye,
  IconPhoto,
  IconTextWrap,
  IconTextWrapDisabled,
} from '../icons';
import { isMarkdown } from '../paths';
import { basenameOf, joinPath, nameProblem, newFilePath, noteNameOf, parentOf } from '../shell/naming';
import { useDraftChrome } from '../shell/PageChrome';
import { PageActions } from '../shell/ShellSlots';
import { layout } from '../theme';
import { showToast } from '../toast';

import { ChangesPane } from './ChangesPane';
import { PreviewPane } from './PreviewPane';
import { SourceEditor, type DroppedFiles, type EditorKind } from './SourceEditor';
import { Splitter } from './Splitter';
import type { TableMenuProps } from './TableMenu';
import { Toolbar } from './Toolbar';
import { codeLanguageOf } from './codeLanguages';
import { draftOpening, tocAttempts, uploadAccept } from './constants';
import { formatMarkdown, replaceText, warmFormatter } from './format';
import classes from './Editor.module.css';
import { lineBreakOf, toEditorText } from './lineBreaks';
import { runMarkdownAction, type MarkdownAction } from './markdownActions';
import { insertTable, runTableEdit, tableEditsAtCursor } from './table';
import { tocBlock, writeToc, writeTocInText } from './toc';
import { useChanges } from './useChanges';
import { useDraft } from './useDraft';
import { useEditorPosition } from './useEditorPosition';
import { useEditSession } from './useEditSession';
import { isLayoutMode, useEditorLayout, type LayoutMode } from './useLayoutMode';
import { useLineWrap } from './useLineWrap';
import { usePreview } from './usePreview';
import { useUploads } from './useUploads';

export interface EditorScreenProps {
  path: string;
  initialContent: string;
  initialRev: string;
  isNew: boolean;
  draft: boolean;
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

const tocFailed = 'Could not build the contents';

function LineCount({ lines, className }: { lines: number; className: string | undefined }): JSX.Element {
  return (
    <Text data-testid="editor-lines" data-lines={lines} className={className}>
      {countOf(lines, 'line')}
    </Text>
  );
}

export function EditorScreen(props: EditorScreenProps): JSX.Element {
  const { path, initialContent, initialRev, isNew, readOnly, draft: drafting } = props;
  const folder = parentOf(path);
  const opening = drafting ? draftOpening : initialContent;
  const editorText = useMemo(() => toEditorText(opening), [opening]);
  const [content, setContent] = useState(editorText);
  const [manual, setManual] = useState<string | undefined>(undefined);
  const [savedAs, setSavedAs] = useState<string | undefined>(undefined);
  const manualRef = useRef(manual);
  const savedAsRef = useRef(savedAs);
  manualRef.current = manual;
  savedAsRef.current = savedAs;
  const named = manual ?? joinPath(folder, noteNameOf(content));
  const filePath = drafting ? (savedAs ?? named) : path;
  const kind: EditorKind = isMarkdown(filePath) ? 'markdown' : 'text';
  const fileName = basenameOf(filePath);
  const formattable = !readOnly && kind === 'markdown';
  const formatOnSave = props.formatOnSave && formattable;
  const lineBreak = formatOnSave ? '\n' : lineBreakOf(opening);

  const [saved, setSaved] = useState(editorText);
  const [rev, setRev] = useState(initialRev);
  const [saving, setSaving] = useState(false);
  const [view, setView] = useState<EditorView | undefined>(undefined);

  const dirty = content !== saved;

  const viewRef = useRef<EditorView | undefined>(undefined);
  const contentRef = useRef(content);
  const revRef = useRef(rev);
  const panesRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

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
    if (drafting) {
      created.dispatch({ selection: { anchor: created.state.doc.length } });
    }
  }, [drafting]);

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

  useOffScreen();

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

  const { previewRef, rememberReadingPosition, chooseMode } = useEditorPosition({
    path,
    drafting,
    view,
    liveView,
    revRef,
    mode,
    previewHtml: preview.html,
    choose,
  });

  const { leaving, cancel, saveAndLeave } = useEditSession({
    path,
    folder,
    drafting,
    readOnly,
    formatOnSave,
    lineBreak,
    dirty,
    exists: rev !== '',
    contentRef,
    revRef,
    manualRef,
    savedAsRef,
    setSaved,
    setRev,
    setSaving,
    setSavedAs,
    liveView,
    bufferText,
    putFormatted,
    formatBuffer,
    uploads,
    draftRef,
    rememberReadingPosition,
  });

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

  const renameDraft = useCallback(
    (typed: string): boolean => {
      const problem = nameProblem(typed);
      if (problem !== undefined) {
        showToast('error', { title: 'Nothing was renamed', message: problem });
        return false;
      }
      const next = newFilePath(folder, typed);
      if (next === '') {
        showToast('error', { message: 'A file needs a letter or a digit in its name' });
        return false;
      }
      if (manualRef.current === undefined && next === joinPath(folder, noteNameOf(bufferText()))) {
        return true;
      }
      if (!isMarkdown(next) && bufferText() === draftOpening) {
        const current = liveView();
        if (current === undefined) {
          setContent('');
        } else {
          replaceText(current, '');
        }
        setSaved('');
      }
      setManual(next);
      return true;
    },
    [bufferText, folder, liveView],
  );

  useDraftChrome(drafting && savedAs === undefined ? { path: named, rename: renameDraft } : undefined);

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
        <Button data-testid="editor-cancel" size="sm" variant="subtle" color="gray" className={classes.cancel} onClick={cancel}>
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
              readOnly={readOnly || leaving}
              autoFocus={!touch || drafting}
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
