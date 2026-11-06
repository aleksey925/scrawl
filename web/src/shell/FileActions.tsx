import { Code, Text } from '@mantine/core';
import { modals } from '@mantine/modals';
import {
  useCallback, useMemo, useState,
  type JSX, type ReactNode,
} from 'react';
import { useLocation, useNavigate } from 'react-router';

import { api } from '../api/client';
import { ApiError } from '../api/errors';
import type { EntryKind, EntryPathResponse } from '../api/types';
import { errorText } from '../api/useApi';
import { mountBase } from '../mount';
import { copyText } from '../reader/clipboard';
import { directoryUrl, documentUrl, isDirectoryPath, isMarkdown, slugPath } from '../paths';
import { layoutBreakpoints, useBelow } from '../theme';
import { showToast } from '../toast';

import { FileActionsContext, type FileActions, type TreeDraft } from './fileActionsContext';
import { MoveDialog } from './MoveDialog';
import { useReaderLayout } from './ReaderLayout';
import { spaceLabel, useNav } from './NavContext';
import { NewEntryDialog } from './NewEntryDialog';
import { RenameDialog } from './RenameDialog';
import { useMutationState } from './useMutationState';
import { basenameOf, hasOwnExtension, joinPath, renamedPath } from './naming';

interface MovedEntry {
  path: string;
  isDir: boolean;
  anchor: DOMRect;
}

function conflictText(error: unknown, fallback: string): string {
  if (error instanceof ApiError && error.status === 409) {
    return fallback;
  }
  return errorText(error);
}

function appUrl(path: string, isDir: boolean): string {
  const base = mountBase().replace(/\/$/, '');
  const route = isDir ? directoryUrl(path) : documentUrl(path);
  return new URL(`${base}${route}`, window.location.origin).href;
}

function draftPath(draft: TreeDraft, name: string): string {
  if (draft.kind === 'file' && hasOwnExtension(name) && !isMarkdown(name.trim())) {
    const typed = name
      .split('/')
      .map((part) => part.trim())
      .filter((part) => part !== '')
      .join('/');
    return joinPath(draft.parent, typed);
  }
  const slug = slugPath(name);
  if (slug === '') {
    return '';
  }
  return joinPath(draft.parent, draft.kind === 'file' && !isMarkdown(slug) ? `${slug}.md` : slug);
}

function movedTo(path: string, from: string, to: string): string | undefined {
  if (path === from) {
    return to;
  }
  return path.startsWith(`${from}/`) ? `${to}${path.slice(from.length)}` : undefined;
}

export function FileActionsProvider({ children }: { children: ReactNode }): JSX.Element {
  const { revealNav: revealTree } = useReaderLayout();
  const navigate = useNavigate();
  const { tree, me, currentPath, refreshNav, openFolder, setQuery } = useNav();
  const onFolder = isDirectoryPath(useLocation().pathname);
  const reportMutation = useMutationState();
  const [renaming, setRenaming] = useState<string | undefined>(undefined);
  const [treeRename, setTreeRename] = useState<string | undefined>(undefined);
  const [moving, setMoving] = useState<MovedEntry | undefined>(undefined);
  const [draft, setDraft] = useState<TreeDraft | undefined>(undefined);
  const phone = useBelow(layoutBreakpoints.phone);
  const [naming, setNaming] = useState<TreeDraft | undefined>(undefined);

  const copyLink = useCallback(async (path: string, isDir: boolean): Promise<void> => {
    if (await copyText(appUrl(path, isDir))) {
      showToast('ok', { message: 'Link copied' });
    } else {
      showToast('error', { message: 'Could not copy the link' });
    }
  }, []);

  const confirmRemove = useCallback(
    (path: string, isDir: boolean, withContents: boolean) => {
      modals.openConfirmModal({
        title: withContents ? 'Delete folder and everything in it?' : isDir ? 'Delete folder?' : 'Delete file?',
        children: (
          <Text data-testid="modal" data-variant={withContents ? 'confirm-contents' : 'confirm'} size="sm">
            {withContents ? (
              <>
                <Code>{path}</Code> is not empty. The folder and every file in it will be removed.
              </>
            ) : (
              <>
                <Code>{path}</Code> will be removed.
              </>
            )}{' '}
            This cannot be undone from the browser.
          </Text>
        ),
        labels: { confirm: withContents ? 'Delete everything' : 'Delete', cancel: 'Cancel' },
        confirmProps: { color: 'red', 'data-testid': 'modal-confirm' },
        cancelProps: { 'data-testid': 'modal-cancel' },
        onConfirm: () => {
          void (async () => {
            try {
              reportMutation(await api.deleteEntry(path, withContents), 'Deleted');
              if (currentPath === path || currentPath.startsWith(`${path}/`)) {
                await navigate('/');
              }
              refreshNav();
            } catch (error) {
              if (isDir && !withContents && error instanceof ApiError && error.status === 409) {
                confirmRemove(path, isDir, true);
                return;
              }
              showToast('error', { title: 'Nothing was deleted', message: errorText(error) });
            }
          })();
        },
      });
    },
    [currentPath, navigate, refreshNav, reportMutation],
  );

  const remove = useCallback(
    (path: string, isDir: boolean) => {
      if (!isDir) {
        confirmRemove(path, isDir, false);
        return;
      }
      void (async () => {
        let holdsEntries = false;
        try {
          holdsEntries = (await api.dir(path)).entries.length > 0;
        } catch {
        }
        confirmRemove(path, isDir, holdsEntries);
      })();
    },
    [confirmRemove],
  );

  const startDraft = useCallback(
    (kind: EntryKind, parent: string) => {
      if (phone) {
        setNaming({ kind, parent });
        return;
      }
      setQuery('');
      openFolder(parent);
      setDraft({ kind, parent });
      revealTree();
    },
    [openFolder, phone, revealTree, setQuery],
  );

  const cancelDraft = useCallback(() => setDraft(undefined), []);

  const createEntry = useCallback(
    async (draft: TreeDraft, name: string): Promise<boolean> => {
      const path = draftPath(draft, name);
      const isFile = draft.kind === 'file';
      if (path === '') {
        showToast('error', { message: `${isFile ? 'A file' : 'A folder'} needs a letter or a digit in its name` });
        return false;
      }
      let res: EntryPathResponse;
      try {
        res = await api.createEntry(path, draft.kind);
      } catch (error) {
        showToast('error', {
          title: 'Nothing was created',
          message: conflictText(error, isFile ? 'That file already exists' : 'That folder already exists'),
        });
        return false;
      }
      refreshNav();
      if (isFile && res.edit_url !== undefined) {
        await navigate(res.edit_url);
        return true;
      }
      if (isFile) {
        reportMutation(res, 'File created');
        await navigate(documentUrl(res.path));
        return true;
      }
      reportMutation(res, 'Folder created');
      openFolder(res.path);
      await navigate(directoryUrl(res.path));
      return true;
    },
    [navigate, openFolder, refreshNav, reportMutation],
  );

  const submitDraft = useCallback(
    async (name: string): Promise<boolean> => {
      if (draft === undefined) {
        return false;
      }
      const created = await createEntry(draft, name);
      if (created) {
        setDraft(undefined);
      }
      return created;
    },
    [createEntry, draft],
  );

  const moveInto = useCallback(
    (paths: readonly string[], folder: string) => {
      void (async () => {
        const moved: { from: string; to: string }[] = [];
        let failure: unknown;
        for (const from of paths) {
          try {
            const res = await api.move(from, joinPath(folder, basenameOf(from)));
            moved.push({ from, to: res.path });
          } catch (error) {
            failure = error;
          }
        }
        if (moved.length > 0) {
          refreshNav();
          openFolder(folder);
          reportMutation(undefined, moved.length === 1 ? 'Moved' : `Moved ${moved.length} items`);
          const here = moved.map((pair) => movedTo(currentPath, pair.from, pair.to)).find((path) => path !== undefined);
          if (here !== undefined) {
            await navigate(onFolder ? directoryUrl(here) : documentUrl(here));
          }
        }
        if (failure !== undefined) {
          showToast('error', {
            title: moved.length > 0 ? 'Some of it did not move' : 'Nothing was moved',
            message: conflictText(failure, 'Something of that name is already there'),
          });
        }
      })();
    },
    [currentPath, navigate, onFolder, openFolder, refreshNav, reportMutation],
  );

  const submitRename = useCallback(
    async (path: string, name: string): Promise<boolean> => {
      if (name.includes('/')) {
        showToast('error', { title: 'Nothing was renamed', message: 'A name cannot hold a slash, use Move to instead' });
        return false;
      }
      const to = renamedPath(path, name);
      if (to === path) {
        return true;
      }
      let res: EntryPathResponse;
      try {
        res = await api.move(path, to);
      } catch (error) {
        showToast('error', {
          title: 'Nothing was renamed',
          message: conflictText(error, 'Something of that name is already there'),
        });
        return false;
      }
      reportMutation(res, 'Renamed');
      const here = movedTo(currentPath, path, res.path);
      if (here !== undefined) {
        await navigate(onFolder ? directoryUrl(here) : documentUrl(here));
        return true;
      }
      refreshNav();
      return true;
    },
    [currentPath, navigate, onFolder, refreshNav, reportMutation],
  );

  const renameInTree = useCallback(
    (path: string) => {
      if (phone) {
        setRenaming(path);
        return;
      }
      setQuery('');
      setTreeRename(path);
      revealTree();
    },
    [phone, revealTree, setQuery],
  );

  const actions = useMemo<FileActions>(
    () => ({
      createPage: (folder) => startDraft('file', folder),
      createFolder: (folder) => startDraft('dir', folder),
      rename: (path) => setRenaming(path),
      renameInTree,
      treeRename,
      submitRename,
      cancelTreeRename: () => setTreeRename(undefined),
      moveTo: (path, isDir, from) => setMoving({ path, isDir, anchor: (from.closest('[role="menu"]') ?? from).getBoundingClientRect() }),
      remove,
      copyLink: (path, isDir) => void copyLink(path, isDir),
      moveInto,
      draft,
      submitDraft,
      cancelDraft,
      createEntry,
    }),
    [cancelDraft, copyLink, createEntry, draft, moveInto, remove, renameInTree, startDraft, submitDraft, submitRename, treeRename],
  );

  return (
    <FileActionsContext.Provider value={actions}>
      {children}

      {naming !== undefined && <NewEntryDialog draft={naming} onCreate={createEntry} onClose={() => setNaming(undefined)} />}

      {renaming !== undefined && (
        <RenameDialog path={renaming} onRename={submitRename} onClose={() => setRenaming(undefined)} />
      )}

      {moving !== undefined && (
        <MoveDialog
          path={moving.path}
          isDir={moving.isDir}
          anchor={moving.anchor}
          tree={tree}
          spaceName={spaceLabel(me)}
          onMove={(folder) => {
            setMoving(undefined);
            moveInto([moving.path], folder);
          }}
          onClose={() => setMoving(undefined)}
        />
      )}
    </FileActionsContext.Provider>
  );
}
