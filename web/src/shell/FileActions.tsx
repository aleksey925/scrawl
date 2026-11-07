import {
  useCallback, useMemo, useRef, useState,
  type JSX, type ReactNode,
} from 'react';
import { useLocation, useNavigate } from 'react-router';

import { api } from '../api/client';
import { ApiError } from '../api/errors';
import type { DeleteResponse, EntryKind, EntryPathResponse, MutationState } from '../api/types';
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
import { ancestorsOf, basenameOf, hasOwnExtension, joinPath, pageName, parentOf, renamedPath } from './naming';

interface Entry {
  path: string;
  isDir: boolean;
}

interface MovedEntry extends Entry {
  anchor: DOMRect;
}

interface Relocation {
  from: string;
  to: string;
}

const failedMoveWords = {
  forward: { partly: 'Some of it did not move', none: 'Nothing was moved' },
  back: { partly: 'Some of it did not move back', none: 'Nothing was moved back' },
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

interface Relocated {
  done: Relocation[];
  left: Relocation[];
  failure: unknown;
  state: MutationState;
}

async function relocateAll(pairs: readonly Relocation[]): Promise<Relocated> {
  const res: Relocated = { done: [], left: [], failure: undefined, state: {} };
  for (const pair of pairs) {
    try {
      const moved = await api.move(pair.from, pair.to);
      res.done.push({ from: pair.from, to: moved.path });
      res.state = {
        unpublished: res.state.unpublished === true || moved.unpublished === true,
        history_degraded: res.state.history_degraded === true || moved.history_degraded === true,
      };
    } catch (error) {
      res.left.push(pair);
      res.failure = error;
    }
  }
  return res;
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

function pathAfterMove(path: string, from: string, to: string): string | undefined {
  if (path === from) {
    return to;
  }
  return path.startsWith(`${from}/`) ? `${to}${path.slice(from.length)}` : undefined;
}

export function FileActionsProvider({ children }: { children: ReactNode }): JSX.Element {
  const { revealNav: revealTree } = useReaderLayout();
  const navigate = useNavigate();
  const { tree, me, currentPath, refreshNav, openFolder, setQuery } = useNav();
  const location = useLocation();
  const onFolder = isDirectoryPath(location.pathname);
  const reportMutation = useMutationState();
  const space = spaceLabel(me);
  const shown = useRef({ path: currentPath, onFolder, route: location.pathname + location.search });
  shown.current = { path: currentPath, onFolder, route: location.pathname + location.search };
  const [renaming, setRenaming] = useState<Entry | undefined>(undefined);
  const [treeRenaming, setTreeRenaming] = useState<string | undefined>(undefined);
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
    async (id: string, path: string, isDir: boolean, back: string | undefined): Promise<boolean> => {
      try {
        reportMutation(await api.restoreTrashed(id), `Restored ${quoted(path, isDir, space)}`);
      } catch (error) {
        showToast('error', {
          title: 'Nothing was restored',
          message: conflictText(error, 'Something of that name is there now'),
        });
        return false;
      }
      refreshNav();
      if (back !== undefined) {
        await navigate(back);
      }
      return true;
    },
    [navigate, refreshNav, reportMutation, space],
  );

  const remove = useCallback(
    (path: string, isDir: boolean) => {
      void (async () => {
        const { path: here, route } = shown.current;
        const back = here === path || here.startsWith(`${path}/`) ? route : undefined;
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
    [navigate, refreshNav, reportMutation, restore, space],
  );

  const showInTree = useCallback(
    (folder: string) => {
      setQuery('');
      ancestorsOf(folder).slice(1).forEach(openFolder);
      revealTree();
    },
    [openFolder, revealTree, setQuery],
  );

  const createDraft = useCallback(
    (kind: EntryKind, parent: string) => {
      if (phone) {
        setNaming({ kind, parent });
        return;
      }
      showInTree(parent);
      setDraft({ kind, parent });
    },
    [phone, showInTree],
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
      const run = async (pairs: readonly Relocation[], back: boolean): Promise<Relocation[]> => {
        const { done, left, failure, state } = await relocateAll(pairs);
        const words = back ? failedMoveWords.back : failedMoveWords.forward;
        if (done.length > 0) {
          refreshNav();
          new Set(done.map((pair) => parentOf(pair.to))).forEach(openFolder);
          let undo = done.map((pair) => ({ from: pair.to, to: pair.from })).reverse();
          reportMutation(
            state,
            movedMessage(done, back, space, (folder) => void navigate(directoryUrl(folder))),
            back
              ? undefined
              : {
                  label: 'Undo',
                  onClick: async () => {
                    undo = await run(undo, true);
                    return undo.length === 0;
                  },
                },
          );
          const here = done.map((pair) => pathAfterMove(shown.current.path, pair.from, pair.to)).find((path) => path !== undefined);
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
        return left;
      };
      void run(paths.map((from) => ({ from, to: joinPath(folder, basenameOf(from)) })), false);
    },
    [navigate, openFolder, refreshNav, reportMutation, space],
  );

  const submitRename = useCallback(
    async (path: string, isDir: boolean, name: string): Promise<boolean> => {
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
      reportMutation(res, `Renamed ${quoted(path, isDir, space)} to ${quoted(res.path, isDir, space)}`);
      const here = pathAfterMove(shown.current.path, path, res.path);
      if (here !== undefined) {
        await navigate(shown.current.onFolder ? directoryUrl(here) : documentUrl(here));
        return true;
      }
      refreshNav();
      return true;
    },
    [navigate, refreshNav, reportMutation, space],
  );

  const startTreeRename = useCallback(
    (path: string, isDir: boolean) => {
      if (phone) {
        setRenaming({ path, isDir });
        return;
      }
      showInTree(parentOf(path));
      setTreeRenaming(path);
    },
    [phone, showInTree],
  );

  const actions = useMemo<FileActions>(
    () => ({
      createDraft,
      rename: (path, isDir) => setRenaming({ path, isDir }),
      startTreeRename,
      treeRenaming,
      submitRename,
      cancelTreeRename: () => setTreeRenaming(undefined),
      moveTo: (path, isDir, anchor) => setMoving({ path, isDir, anchor }),
      remove,
      copyLink: (path, isDir) => void copyLink(path, isDir),
      moveInto,
      draft,
      submitDraft,
      cancelDraft,
      createEntry,
    }),
    [cancelDraft, copyLink, createDraft, createEntry, draft, moveInto, remove, startTreeRename, submitDraft, submitRename, treeRenaming],
  );

  return (
    <FileActionsContext.Provider value={actions}>
      {children}

      {naming !== undefined && <NewEntryDialog draft={naming} onCreate={createEntry} onClose={() => setNaming(undefined)} />}

      {renaming !== undefined && (
        <RenameDialog
          path={renaming.path}
          onRename={(name) => submitRename(renaming.path, renaming.isDir, name)}
          onClose={() => setRenaming(undefined)}
        />
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
