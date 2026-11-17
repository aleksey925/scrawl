import { EditorView } from '@codemirror/view';
import {
  ActionIcon,
  Alert,
  Button,
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
  IconChevronLeft,
  IconColumns,
  IconDiff,
  IconEye,
  IconKeyboard,
  IconPhoto,
  IconTextWrap,
  IconTextWrapDisabled,
} from '../icons';
import { isMarkdown } from '../paths';
import { basenameOf, joinPath, nameProblem, newFilePath, noteNameOf, parentOf } from '../shell/naming';
import { useDraftChrome } from '../shell/PageChrome';
import { PageActions } from '../shell/ShellSlots';
import { useVisibleScreen } from '../shell/useVisibleArea';
import { layout, layoutBreakpoints, useBelow } from '../theme';
import { showToast } from '../toast';

import { ChangesPane } from './ChangesPane';
import { PreviewPane } from './PreviewPane';
import { SourceEditor, type DroppedFiles, type EditorKind } from './SourceEditor';
import { Splitter } from './Splitter';
import type { TableMenuProps } from './TableMenu';
import { Toolbar } from './Toolbar';
import { ToolButton } from './ToolButton';
import { codeLanguageOf } from './codeLanguages';
import { DraftOffer } from './DraftOffer';
import { draftOpening, tocAttempts, tocRefreshMs, uploadAccept } from './constants';
import { formatMarkdown, replaceText, warmFormatter } from './format';
import classes from './Editor.module.css';
import { lineBreakOf, toEditorText } from './lineBreaks';
import { runMarkdownAction, type MarkdownAction } from './markdownActions';
import { insertTable, runTableEdit, tableEditsAtCursor } from './table';
import { tocBlock, tocRangeIn, writeToc, writeTocInText } from './toc';
import { useChanges } from './useChanges';
import { useDraft } from './useDraft';
import { useEditing } from './useEditing';
import { useEditorPosition } from './useEditorPosition';
import { useEditSession } from './useEditSession';
import { useEditorLayout, type LayoutMode } from './useLayoutMode';
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

const narrowModeOptions = modeOptions.filter((option) => option.value !== 'split');

type SaveState = 'saving' | 'uploading' | 'dirty' | 'drafted' | 'new' | 'saved';

const saveStateText: Record<SaveState, string> = {
  saving: 'Saving',
  uploading: 'Waiting for the upload',
  dirty: 'Unsaved changes',
  drafted: 'Draft on device',
  new: 'New note',
  saved: 'Saved',
};

type PhoneMode = Exclude<LayoutMode, 'split'>;

const tocFailed = 'Could not build the contents';
const tocNoAnswer = `The server did not answer in ${tocRefreshMs / 1000} seconds.`;

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
  const { choose, split, setSplit, wide } = layoutControl;
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

  const phone = useBelow(layoutBreakpoints.phone);
  const phoneModes = phone && kind === 'markdown';
  const screenRef = useRef<HTMLDivElement>(null);
  const keyboardBarRef = useRef<HTMLDivElement>(null);
  const [tableOpen, setTableOpen] = useState(false);
  const keyboardTools = phoneModes && !readOnly && mode === 'source';
  const editing = useEditing(view, keyboardBarRef, keyboardTools);
  const typing = keyboardTools && (editing || tableOpen);
  useVisibleScreen(screenRef, phone);

  useEffect(() => {
    const visual = window.visualViewport;
    if (!typing || view === undefined) {
      return undefined;
    }
    let height = visual?.height ?? 0;
    const reveal = (): void => {
      view.dispatch({ effects: EditorView.scrollIntoView(view.state.selection.main.head) });
    };
    const shrink = (): void => {
      const next = visual?.height ?? 0;
      if (next < height) {
        reveal();
      }
      height = next;
    };
    reveal();
    visual?.addEventListener('resize', shrink);
    return () => {
      visual?.removeEventListener('resize', shrink);
    };
  }, [typing, view]);

  const hideKeyboard = useCallback((): void => {
    const active = document.activeElement;
    if (active instanceof HTMLElement && (keyboardBarRef.current?.contains(active) === true || viewRef.current?.dom.contains(active) === true)) {
      active.blur();
    }
  }, []);

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

  const putIfUnchanged = useCallback(
    (sent: string, text: string, cursor?: number): boolean => {
      if (bufferText() !== sent) {
        return false;
      }
      const current = liveView();
      if (current === undefined) {
        contentRef.current = text;
        setContent(text);
      } else {
        replaceText(current, text, cursor);
      }
      return true;
    },
    [bufferText, liveView],
  );

  const formatBuffer = useCallback(async (): Promise<string> => {
    const sent = bufferText();
    const res = await formatMarkdown(sent, liveView()?.state.selection.main.head ?? 0);
    putIfUnchanged(sent, res.text, res.cursor);
    return res.text;
  }, [bufferText, liveView, putIfUnchanged]);

  const format = useCallback((): void => {
    if (viewRef.current?.state.readOnly === true) {
      return;
    }
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
          if (res.toc.length === 0) {
            showToast('warn', { title: 'No headings to list', message: 'The contents lists the headings under the title.' });
            return;
          }
          const block = tocBlock(res.toc);
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

  const refreshToc = useCallback(async (): Promise<string | undefined> => {
    const sent = bufferText();
    const range = kind === 'markdown' ? tocRangeIn(sent) : undefined;
    if (range === undefined) {
      return undefined;
    }
    try {
      const res = await api.preview({ content: sent, path }, { signal: AbortSignal.timeout(tocRefreshMs) });
      putIfUnchanged(sent, `${sent.slice(0, range.from)}${tocBlock(res.toc)}${sent.slice(range.to)}`);
      return undefined;
    } catch (error: unknown) {
      return error instanceof DOMException && error.name === 'TimeoutError' ? tocNoAnswer : errorText(error);
    }
  }, [bufferText, kind, path, putIfUnchanged]);

  useEffect(() => {
    if (formatOnSave) {
      warmFormatter(contentRef.current);
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
    putIfUnchanged,
    formatBuffer,
    refreshToc,
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
      onOpenedChange: setTableOpen,
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
        ? draft.stored
          ? 'drafted'
          : 'dirty'
        : isNew
          ? 'new'
          : 'saved';

  const statusText = saveState === 'new' && kind === 'text' ? 'New file' : saveStateText[saveState];
  const unsaved = saveState === 'dirty' || saveState === 'drafted';
  const savable = dirty || rev === '';
  const phoneOptions: SegmentedOption<PhoneMode>[] = [
    { value: 'source', label: 'Text', testId: 'editor-tab-source' },
    { value: 'preview', label: 'Preview', testId: 'editor-tab-preview' },
    {
      value: 'changes',
      label: 'Changes',
      testId: 'editor-tab-changes',
      mark: dirty ? <span data-testid="editor-changes-mark" className={classes.changesMark} aria-hidden /> : undefined,
    },
  ];
  const wrapButton = (size: number): JSX.Element => (
    <ToolButton testId="editor-wrap" label="Wrap long lines" aria-pressed={lineWrap.wrap} onClick={lineWrap.toggle}>
      {lineWrap.wrap ? <IconTextWrap size={size} /> : <IconTextWrapDisabled size={size} />}
    </ToolButton>
  );
  const toolbar = !readOnly && kind === 'markdown' && (
    <Toolbar
      onAction={onAction}
      onPickImage={() => fileRef.current?.click()}
      onToc={insertToc}
      tableMenu={tableMenu}
      onFormat={formattable ? format : undefined}
      iconSize={phoneModes ? layout.iconSizeLarge : layout.iconSizeTool}
    >
      {phoneModes ? wrapButton(layout.iconSizeLarge) : undefined}
    </Toolbar>
  );
  const status = (
    <Text
      data-testid="editor-status"
      data-dirty={dirty ? 'true' : 'false'}
      data-state={saveState}
      className={phone ? classes.phoneStatus : classes.status}
      hidden={!phone && !wide}
      aria-live="polite"
    >
      {phone && unsaved && <span data-testid="editor-unsaved-mark" className={classes.unsavedMark} aria-hidden />}
      {statusText}
    </Text>
  );

  const sourceStyle = mode === 'split' ? { flex: `0 0 ${split * 100}%` } : undefined;
  const previewStyle = mode === 'split' ? { flex: '1 1 0' } : undefined;

  return (
    <div ref={screenRef} data-testid="editor" data-kind={kind} data-fill="screen" className={classes.screen}>
      <PageActions>
        {!phone ? (
          <>
            {status}
            {kind === 'markdown' && (
              <Segmented
                data-testid="editor-layout-mode"
                data-mode={mode}
                size="xs"
                value={mode}
                onChange={chooseMode}
                aria-label="Editor layout"
                classNames={{ root: classes.modes, label: classes.mode }}
                options={wide ? modeOptions : narrowModeOptions}
                compact
              />
            )}
            <Button data-testid="editor-cancel" size="sm" variant="subtle" color="gray" onClick={cancel}>
              Cancel
            </Button>
            {!readOnly && (
              <Button data-testid="editor-save" size="sm" loading={saving} onClick={() => void saveAndLeave()}>
                Save
              </Button>
            )}
          </>
        ) : (
          <>
            <button type="button" data-testid="editor-cancel" className={classes.back} aria-label="Back" onClick={cancel}>
              <IconChevronLeft size={layout.iconSizeLarge} />
            </button>
            {status}
            {!readOnly && (
              <button
                type="button"
                data-testid="editor-save"
                className={classes.phoneSave}
                disabled={!savable || saving || leaving}
                onClick={() => void saveAndLeave()}
              >
                Save
              </button>
            )}
          </>
        )}
      </PageActions>

      {draft.offered !== undefined && (
        <DraftOffer
          at={draft.offered.at}
          stale={draft.stale}
          disabled={leaving}
          onRestore={() => {
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
          onDiscard={draft.discard}
        />
      )}

      {readOnly && (
        <div className={classes.notices}>
          <Alert data-testid="editor-readonly" color="yellow" variant="light">
            This server is read-only. You can read the source here, but it cannot be saved.
          </Alert>
        </div>
      )}

      <div data-testid="editor-panes" data-mode={mode} className={classes.panes} ref={panesRef}>
        {showSource && (
          <div className={classes.pane} style={sourceStyle}>
            {(!phoneModes || readOnly) && (
              <div className={classes.paneHead}>
                {mode === 'split' && <span className={classes.paneLabel}>Source</span>}
                {kind === 'text' && (
                  <span data-testid="editor-language" className={classes.paneLabel}>
                    {codeLanguageOf(fileName)?.name ?? 'Plain text'}
                  </span>
                )}
                {toolbar}
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
                  {wrapButton(layout.iconSizeSmall)}
                </div>
              </div>
            )}
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
              outerScroll={touch && mode !== 'split' && !lineWrap.wrap}
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

      {!wide && kind === 'text' && (
        <LineCount lines={lines} className={classes.footLines} />
      )}

      {phoneModes && (
          <div data-testid="editor-strip" data-typing={typing ? 'true' : 'false'} className={classes.phoneBar}>
            {typing ? (
              <div ref={keyboardBarRef} data-testid="editor-keyboard-bar" className={classes.keyboardBar}>
                {toolbar}
                <div className={classes.keyboardEnd}>
                  <ToolButton
                    testId="editor-hide-keyboard"
                    label="Hide the keyboard"
                    onClick={hideKeyboard}
                  >
                    <IconKeyboard size={layout.iconSizeLarge} />
                  </ToolButton>
                </div>
              </div>
            ) : (
              <Segmented<PhoneMode>
                data-testid="editor-tabs"
                data-mode={mode}
                fullWidth
                value={mode === 'split' ? 'source' : mode}
                onChange={chooseMode}
                aria-label="Editor layout"
                classNames={{ label: classes.phoneMode }}
                options={phoneOptions}
              />
            )}
          </div>
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
