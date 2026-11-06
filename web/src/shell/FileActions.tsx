import {
  useCallback, useMemo, useRef, useState,
  type JSX, type ReactNode,
} from 'react';
import { useLocation, useNavigate } from 'react-router';

import { api } from '../api/client';
import { ApiError } from '../api/errors';
import type { DeleteResponse, EntryKind, EntryPathResponse } from '../api/types';
import { errorText } from '../api/useApi';
import { mountBase } from '../mount';
import { copyText } from '../reader/clipboard';
import { directoryUrl, documentUrl, isDirectoryPath, isMarkdown, slugPath } from '../paths';
import { layoutBreakpoints, useBelow } from '../theme';
import { showToast, ToastLink } from '../toast';

import { FileActionsContext, type FileActions, type TreeDraft } from './fileActionsContext';
import { MoveDialog } from './MoveDialog';
import { useReaderLayout } from './ReaderLayout';
import { spaceLabel, useNav } from './NavContext';
import { NewEntryDialog } from './NewEntryDialog';
import { RenameDialog } from './RenameDialog';
import { useMutationState } from './useMutationState';
import { basenameOf, hasOwnExtension, joinPath, pageName, parentOf, renamedPath } from './naming';

interface MovedEntry {
  path: string;
  isDir: boolean;
  anchor: DOMRect;
}

interface Relocation {
  from: string;
  to: string;
}

interface MoveWords {
  back: boolean;
  partly: string;
  none: string;
}

const forwardWords: MoveWords = {
  back: false,
  partly: 'Some of it did not move',
  none: 'Nothing was moved',
};

const backWords: MoveWords = {
  back: true,
  partly: 'Some of it did not move back',
  none: 'Nothing was moved back',
};

function quoted(path: string, isDir: boolean, spaceName: string): string {
  return `"${path === '' ? spaceName : pageName(basenameOf(path), isDir)}"`;
}

function movedMessage(
  done: readonly Relocation[], back: boolean, spaceName: string, visit: (folder: string) => void,
): ReactNode {
  const [first] = done;
  const what = done.length === 1 && first !== undefined ? quoted(first.to, false, spaceName) : `${done.length} items`;
  const [folder, ...others] = new Set(done.map((pair) => parentOf(pair.to)));
  return (
    <>
      Moved {what}
      {back ? ' back' : ''}
      {folder !== undefined && others.length === 0 && (
        <>
          {' to '}
          <ToastLink onClick={() => visit(folder)}>{quoted(folder, true, spaceName)}</ToastLink>
        </>
      )}
    </>
  );
}

async function relocateAll(pairs: readonly Relocation[]): Promise<{ done: Relocation[]; failure: unknown }> {
  const done: Relocation[] = [];
  let failure: unknown;
  for (const pair of pairs) {
    try {
      const res = await api.move(pair.from, pair.to);
      done.push({ from: pair.from, to: res.path });
    } catch (error) {
      failure = error;
    }
  }
  return { done, failure };
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
  const space = spaceLabel(me);
  const shown = useRef({ path: currentPath, onFolder });
  shown.current = { path: currentPath, onFolder };
  const [renaming, setRenaming] = useState<string | undefined>(undefined);
  const [treeRename, setTreeRename] = useState<string | undefined>(undefined);
  const [moving, setMoving] = useState<MovedEntry | undefined>(undefined);
  const [draft, setDraft] = useState<TreeDraft | undefined>(undefined);
  const phone = useBelow(layoutBreakpoints.phone);
  const [naming, setNaming] = useState<TreeDraft | undefined>(undefined);

  const copyLink = useCallback(async (path: string, isDir: boolean): Promise<void> => {
    if (await copyText(appUrl(path, isDir))) {
      showToast('ok', { message: `Copied the link to ${quoted(path, isDir, space)}` });
    } else {
      showToast('error', { message: 'Could not copy the link' });
    }
  }, [space]);

  const restore = useCallback(
    (id: string, path: string, isDir: boolean, back: { path: string; onFolder: boolean } | undefined) => {
      void (async () => {
        try {
          reportMutation(await api.restoreDeleted(id), `Restored ${quoted(path, isDir, space)}`);
        } catch (error) {
          showToast('error', {
            title: 'Nothing was restored',
            message: conflictText(error, 'Something of that name is there now'),
          });
          return;
        }
        refreshNav();
        if (back !== undefined) {
          await navigate(back.onFolder ? directoryUrl(back.path) : documentUrl(back.path));
        }
      })();
    },
    [navigate, refreshNav, reportMutation, space],
  );

  const remove = useCallback(
    (path: string, isDir: boolean) => {
      void (async () => {
        const back = currentPath === path || currentPath.startsWith(`${path}/`) ? { ...shown.current } : undefined;
        let res: DeleteResponse;
        try {
          res = await api.deleteEntry(path);
        } catch (error) {
          showToast('error', { title: 'Nothing was deleted', message: errorText(error) });
          return;
        }
        reportMutation(res, `Deleted ${quoted(path, isDir, space)}`, {
          label: 'Undo',
          onClick: () => restore(res.trash_id, path, isDir, back),
        });
        if (back !== undefined) {
          await navigate('/');
        }
        refreshNav();
      })();
    },
    [currentPath, navigate, refreshNav, reportMutation, restore, space],
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
        reportMutation(res, `Created ${quoted(res.path, false, space)}`);
        await navigate(documentUrl(res.path));
        return true;
      }
      reportMutation(res, `Created folder ${quoted(res.path, true, space)}`);
      openFolder(res.path);
      await navigate(directoryUrl(res.path));
      return true;
    },
    [navigate, openFolder, refreshNav, reportMutation, space],
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
      const run = async (pairs: readonly Relocation[], words: MoveWords, undoable: boolean): Promise<void> => {
        const { done, failure } = await relocateAll(pairs);
        if (done.length > 0) {
          refreshNav();
          new Set(done.map((pair) => parentOf(pair.to))).forEach(openFolder);
          const back = done.map((pair) => ({ from: pair.to, to: pair.from })).reverse();
          reportMutation(
            undefined,
            movedMessage(done, words.back, space, (folder) => void navigate(directoryUrl(folder))),
            undoable ? { label: 'Undo', onClick: () => void run(back, backWords, false) } : undefined,
          );
          const here = done.map((pair) => movedTo(shown.current.path, pair.from, pair.to)).find((path) => path !== undefined);
          if (here !== undefined) {
            await navigate(shown.current.onFolder ? directoryUrl(here) : documentUrl(here));
          }
        }
        if (failure !== undefined) {
          showToast('error', {
            title: done.length > 0 ? words.partly : words.none,
            message: conflictText(failure, 'Something of that name is already there'),
          });
        }
      };
      void run(paths.map((from) => ({ from, to: joinPath(folder, basenameOf(from)) })), forwardWords, true);
    },
    [navigate, openFolder, refreshNav, reportMutation, space],
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
      reportMutation(res, `Renamed ${quoted(path, false, space)} to ${quoted(res.path, false, space)}`);
      const here = movedTo(currentPath, path, res.path);
      if (here !== undefined) {
        await navigate(onFolder ? directoryUrl(here) : documentUrl(here));
        return true;
      }
      refreshNav();
      return true;
    },
    [currentPath, navigate, onFolder, refreshNav, reportMutation, space],
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
          spaceName={space}
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
