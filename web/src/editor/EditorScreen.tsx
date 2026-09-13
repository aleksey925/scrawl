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
import { notifications } from '@mantine/notifications';
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
import { documentUrl, editUrl } from '../paths';
import { PageActions } from '../shell/ShellSlots';
import { layout } from '../theme';

import { PreviewPane } from './PreviewPane';
import { SourceEditor, type DroppedFiles } from './SourceEditor';
import { Splitter } from './Splitter';
import { Toolbar } from './Toolbar';
import {
  blockForLine,
  blockTopWithin,
  clamp,
  fractionOfLine,
  isReadingAnchor,
  lineAtFraction,
  rememberAnchor,
  recallAnchor,
  sourceBlocks,
  type ReadingAnchor,
} from './anchor';
import { firstVisibleLine, holdLineAtReading, lineAtReadingPosition, scrollLineToReading } from './cmAnchor';
import { readingFraction, uploadAccept } from './constants';
import { confirmLeave, openConflict, openSessionExpired } from './dialogs';
import classes from './Editor.module.css';
import { runMarkdownAction, type MarkdownAction } from './markdownActions';
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

export function EditorScreen(props: EditorScreenProps): JSX.Element {
  const { path, initialContent, initialRev, isNew, readOnly } = props;
  const navigate = useNavigate();
  const location = useLocation();

  const [content, setContent] = useState(initialContent);
  const [saved, setSaved] = useState(initialContent);
  const [rev, setRev] = useState(initialRev);
  const [saving, setSaving] = useState(false);
  const [view, setView] = useState<EditorView | undefined>(undefined);

  const dirty = content !== saved;

  const viewRef = useRef<EditorView | undefined>(undefined);
  const contentRef = useRef(content);
  const revRef = useRef(rev);
  const savingRef = useRef(false);
  const leavingRef = useRef(false);
  const syncingRef = useRef(false);
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

  useEffect(() => {
    if (view === undefined) {
      return;
    }
    const carried = arrivedWith.current;
    const anchor =
      isReadingAnchor(carried) && carried.path === path ? carried : recallAnchor('edit', path);
    if (anchor === undefined) {
      return;
    }
    return holdLineAtReading(view, lineAtFraction(anchor, anchor.fractionWithinBlock));
  }, [view, path]);

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

  const syncFromSource = useCallback((): void => {
    const current = viewRef.current;
    const pane = previewRef.current;
    if (syncingRef.current || current === undefined || pane === null) {
      return;
    }
    syncingRef.current = true;
    const line = lineAtReadingPosition(current);
    const block = blockForLine(sourceBlocks(pane), line);
    if (block === undefined) {
      const max = current.scrollDOM.scrollHeight - current.scrollDOM.clientHeight;
      const ratio = max > 0 ? current.scrollDOM.scrollTop / max : 0;
      pane.scrollTop = ratio * (pane.scrollHeight - pane.clientHeight);
    } else {
      const top =
        blockTopWithin(pane, block.element) +
        block.element.offsetHeight * fractionOfLine(block, line);
      pane.scrollTop = Math.max(0, top - pane.clientHeight * readingFraction);
    }
    requestAnimationFrame(() => {
      syncingRef.current = false;
    });
  }, []);

  const syncFromPreview = useCallback((): void => {
    const current = viewRef.current;
    const pane = previewRef.current;
    if (syncingRef.current || current === undefined || pane === null) {
      return;
    }
    syncingRef.current = true;
    const y = pane.scrollTop + pane.clientHeight * readingFraction;
    const blocks = sourceBlocks(pane);
    const target = blocks.find(
      (block) => blockTopWithin(pane, block.element) + block.element.offsetHeight > y,
    );
    if (target === undefined) {
      const max = pane.scrollHeight - pane.clientHeight;
      const ratio = max > 0 ? pane.scrollTop / max : 0;
      const scroller = current.scrollDOM;
      scroller.scrollTop = ratio * (scroller.scrollHeight - scroller.clientHeight);
    } else {
      const top = blockTopWithin(pane, target.element);
      const height = target.element.offsetHeight;
      const within = height > 0 ? clamp((y - top) / height, 0, 1) : 0;
      scrollLineToReading(current, lineAtFraction(target, within));
    }
    requestAnimationFrame(() => {
      syncingRef.current = false;
    });
  }, []);

  useEffect(() => {
    const pane = previewRef.current;
    if (view === undefined || mode !== 'split' || pane === null) {
      return;
    }
    const scroller = view.scrollDOM;
    scroller.addEventListener('scroll', syncFromSource, { passive: true });
    pane.addEventListener('scroll', syncFromPreview, { passive: true });
    return () => {
      scroller.removeEventListener('scroll', syncFromSource);
      pane.removeEventListener('scroll', syncFromPreview);
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

  const markSaved = useCallback((sent: string, nextRev: string): void => {
    setSaved(sent);
    setRev(nextRev);
    if (contentRef.current === sent) {
      draftRef.current.clear();
    }
  }, []);

  const saveCopy = useCallback(async (): Promise<void> => {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const copyPath = `${path.replace(/\.md$/, '')}.conflict-${stamp}.md`;
    const sent = contentRef.current;
    try {
      await api.saveFile(copyPath, { content: sent, rev: '' });
      setSaved(sent);
      draftRef.current.clear();
      leavingRef.current = true;
      await navigate(editUrl(copyPath));
    } catch (error: unknown) {
      notifications.show({ message: errorText(error), color: 'red' });
    }
  }, [navigate, path]);

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
      const sent = contentRef.current;
      try {
        // an upload still in flight has its placeholder sitting in the text,
        // and saving now writes that to disk as the document
        await uploads.wait();
        draftRef.current.flush();
        const res = await api.saveFile(path, { content: sent, rev: withRev ?? revRef.current });
        markSaved(sent, res.rev);
        notifications.show({ message: 'Saved', color: 'green' });
      } catch (error: unknown) {
        if (error instanceof ApiError && (error.status === 412 || error.status === 409)) {
          const current: ApiConflict | undefined =
            error.conflict ?? (await api.file(path).catch(() => undefined));
          if (current === undefined) {
            notifications.show({ message: errorText(error), color: 'red' });
            return;
          }
          // a response lost on the way back leaves the write done and this
          // editor a revision behind, so the retry collides with its own text
          if (current.content === sent) {
            markSaved(sent, current.rev);
            notifications.show({ message: 'Saved', color: 'green' });
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
          openSessionExpired(`/login?from=${encodeURIComponent(location.pathname)}`);
          return;
        }
        notifications.show({ message: errorText(error), color: 'red' });
      } finally {
        savingRef.current = false;
        setSaving(false);
      }
    },
    [location.pathname, markSaved, path, readOnly, rememberReadingPosition, saveCopy, uploads],
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

  const status = saving
    ? 'Saving'
    : uploads.pending > 0
      ? 'Waiting for the upload'
      : dirty
        ? 'Unsaved changes'
        : isNew
          ? 'New page'
          : 'Saved';

  const showSource = mode !== 'preview';
  const showPreview = mode !== 'source';
  const sourceStyle = mode === 'split' ? { flex: `0 0 ${split * 100}%` } : undefined;
  const previewStyle = mode === 'split' ? { flex: '1 1 0' } : undefined;

  return (
    <div className={classes.screen}>
      <PageActions>
        {wide && (
          <SegmentedControl
            size="xs"
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
            size="xs"
            loading={saving}
            leftSection={<IconDeviceFloppy size={16} />}
            onClick={() => void save()}
          >
            Save
          </Button>
        )}
        <Button
          variant="subtle"
          color="gray"
          size="xs"
          leftSection={<IconX size={16} />}
          onClick={cancel}
        >
          Cancel
        </Button>
      </PageActions>

      {readOnly && (
        <Alert color="yellow" variant="light">
          This server is read-only. You can read the source here, but it cannot be saved.
        </Alert>
      )}

      {draft.offered !== undefined && (
        <Alert color="yellow" variant="light" title="An unsaved draft was found">
          <Group justify="space-between" wrap="wrap" gap="sm">
            <Text size="sm">
              {`Written ${new Date(draft.offered.at).toLocaleString()}`}
              {draft.stale ? ', against an older version of this page.' : '.'}
            </Text>
            <Group gap="xs">
              <Button
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
              <Button size="xs" variant="subtle" color="gray" onClick={draft.discard}>
                Discard
              </Button>
            </Group>
          </Group>
        </Alert>
      )}

      {!wide && (
        <Tabs
          value={mode === 'preview' ? 'preview' : 'source'}
          onChange={(value) => choose(value === 'preview' ? 'preview' : 'source')}
        >
          <Tabs.List grow>
            <Tabs.Tab value="source" h={layout.tapTarget}>
              Text
            </Tabs.Tab>
            <Tabs.Tab value="preview" h={layout.tapTarget}>
              Preview
            </Tabs.Tab>
          </Tabs.List>
        </Tabs>
      )}

      {!readOnly && showSource && (
        <Group gap="xs" wrap="nowrap">
          <Toolbar onAction={onAction} onPickImage={() => fileRef.current?.click()} />
          {uploads.pending > 0 && (
            <ActionIcon size={layout.tapTarget} variant="subtle" color="gray" loading aria-label="Uploading">
              <IconPhoto size={18} />
            </ActionIcon>
          )}
        </Group>
      )}

      <div className={classes.panes} ref={panesRef}>
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
        <Text size="xs" c="dimmed">
          {`${lines} lines`}
        </Text>
        <Text size="xs" c="dimmed" aria-live="polite">
          {status}
        </Text>
        <Text size="xs" c="dimmed" truncate>
          {path}
        </Text>
      </Group>

      <input
        ref={fileRef}
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
