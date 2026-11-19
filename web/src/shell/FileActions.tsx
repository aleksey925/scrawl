import {
  useCallback, useEffect, useMemo, useRef, useState,
  type JSX, type ReactNode,
} from 'react';
import { useLocation, useNavigate } from 'react-router';

import { api } from '../api/client';
import { ApiError } from '../api/errors';
import type { DeleteResponse, EntryPathResponse, NavNode } from '../api/types';
import { errorText } from '../api/useApi';
import { moveDrafts } from '../editor/draftKeys';
import { mountBase } from '../mount';
import { usePlatform } from '../platform';
import { copyText } from '../reader/clipboard';
import { directoryUrl, documentUrl, draftUrl, isDirectoryPath, isEditPath, isMarkdown, slugPath } from '../paths';
import { layoutBreakpoints, useBelow } from '../theme';
import { showToast, ToastLink, type ToastAction } from '../toast';

import { MoveDialog } from './dialogChunks';
import { FileActionsContext, type FileActions, type FolderDraft, type RenamePlace, type Renaming } from './fileActionsContext';
import { useReaderLayout } from './ReaderLayout';
import { spaceLabel, useAccount, useTree } from './NavContext';
import { useMutationState } from './useMutationState';
import {
  ancestorsOf, basenameOf, contentPathOf, folderFor, freeName, joinPath, nameProblem, parentOf, pathAfterMove, renamedPath, replaces,
} from './naming';
import { parentsOf, UndoMarks, type MoveUndo, type Relocated, type Relocation } from './relocation';
import { plainShortcut } from './shortcuts';

interface MovedEntry {
  path: string;
  anchor: DOMRect;
}

const changedSinceText = 'It was renamed, moved or deleted since';

const notRenamedTitle = 'Nothing was renamed';

const takenText = 'Something of that name is already there';

const failedMoveWords = {
  forward: { partly: 'Some of it did not move', none: 'Nothing was moved' },
  back: { partly: 'Some of it did not move back', none: 'Nothing was moved back' },
};

function quoted(path: string, spaceName: string): string {
  return `“${path === '' ? spaceName : basenameOf(path)}”`;
}

function renamedMessage(from: string, to: string, isDir: boolean, spaceName: string): string {
  const message = `Renamed ${quoted(from, spaceName)} to ${quoted(to, spaceName)}`;
  return !isDir && isMarkdown(from) && !isMarkdown(to) ? `${message}. It is not a note now, so the tree does not show it` : message;
}

function movedMessage(
  done: readonly Relocation[], back: boolean, spaceName: string, visit: (folder: string) => void,
): ReactNode {
  const [first] = done;
  const what = done.length === 1 && first !== undefined ? quoted(first.to, spaceName) : `${done.length} items`;
  const [folder, ...others] = parentsOf(done);
  return (
    <>
      Moved {what}
      {back ? ' back' : ''}
      {folder !== undefined && others.length === 0 && (
        <>
          {' to '}
          <ToastLink onClick={() => visit(folder)}>{quoted(folder, spaceName)}</ToastLink>
        </>
      )}
    </>
  );
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

function childrenOf(tree: readonly NavNode[], folder: string): readonly NavNode[] {
  let nodes = tree;
  for (const step of ancestorsOf(folder).slice(1)) {
    nodes = nodes.find((entry) => entry.path === step)?.children ?? [];
  }
  return nodes;
}

export function FileActionsProvider({ children }: { children: ReactNode }): JSX.Element {
  const { revealNav: revealTree } = useReaderLayout();
  const navigate = useNavigate();
  const { me, canWrite, refreshMe } = useAccount();
  const { tree, currentPath, refreshTree, openFolder, setQuery } = useTree();
  const location = useLocation();
  const onFolder = isDirectoryPath(location.pathname);
  const reportMutation = useMutationState();
  const space = spaceLabel(me);
  const shown = useRef({ path: currentPath, onFolder, route: location.pathname + location.search });
  shown.current = { path: currentPath, onFolder, route: location.pathname + location.search };
  const [renaming, setRenaming] = useState<Renaming | undefined>(undefined);
  const renameSessions = useRef(0);
  const renameCommit = useRef<(() => void) | undefined>(undefined);
  const followed = useRef<{ path: string; url: string } | undefined>(undefined);
  const [moving, setMoving] = useState<MovedEntry | undefined>(undefined);
  const [draft, setDraft] = useState<FolderDraft | undefined>(undefined);
  const phone = useBelow(layoutBreakpoints.phone);
  const [marks] = useState(() => new UndoMarks());
  const latestTree = useRef(tree);
  latestTree.current = tree;
  const { storageScope } = usePlatform();
  const draftMoves = useRef<readonly Relocation[]>([]);

  const relocateDrafts = useCallback((steps: readonly Relocation[], leaving: boolean) => {
    steps.forEach((move) => moveDrafts(storageScope, move.from, move.to));
    if (leaving) {
      draftMoves.current = [...draftMoves.current, ...steps];
    }
  }, [storageScope]);

  useEffect(() => {
    const follow = followed.current;
    followed.current = undefined;
    setRenaming((prev) =>
      prev !== undefined && follow?.url === location.pathname && !replaces(follow.path, prev.path) ? prev : undefined,
    );
  }, [location.pathname]);

  useEffect(() => {
    const steps = draftMoves.current;
    draftMoves.current = [];
    steps.forEach((move) => moveDrafts(storageScope, move.from, move.to));
  }, [location.pathname, storageScope]);

  const copyLink = useCallback(async (path: string, isDir: boolean): Promise<void> => {
    if (await copyText(appUrl(path, isDir))) {
      showToast('ok', { message: `Copied the link to ${quoted(path, space)}` });
    } else {
      showToast('error', { message: 'Could not copy the link' });
    }
  }, [space]);

  const settle = useCallback(() => {
    refreshMe();
    refreshTree();
  }, [refreshMe, refreshTree]);

  const undoDelete = useCallback(
    async (deleting: Promise<DeleteResponse | undefined>, path: string, back: string | undefined): Promise<boolean> => {
      const deleted = await deleting;
      if (deleted === undefined) {
        return true;
      }
      try {
        reportMutation(await api.restoreTrashed(deleted.trash_id), `Restored ${quoted(path, space)}`);
      } catch (error) {
        showToast('error', {
          title: 'Nothing was restored',
          message: conflictText(error, 'Something of that name is there now'),
        });
        return false;
      }
      refreshTree();
      if (back !== undefined) {
        await navigate(back);
      }
      return true;
    },
    [navigate, refreshTree, reportMutation, space],
  );

  const remove = useCallback(
    (path: string) => {
      const { path: here, route } = shown.current;
      const back = replaces(path, here) ? route : undefined;
      const deleting = api.deleteEntry(path).then(
        (res) => {
          settle();
          return res;
        },
        (error: unknown) => {
          showToast('error', { title: 'Nothing was deleted', message: errorText(error) });
          settle();
          return undefined;
        },
      );
      marks.touch([path]);
      showToast('ok', {
        message: `Deleted ${quoted(path, space)}`,
        action: { label: 'Undo', onClick: () => undoDelete(deleting, path, back) },
      });
      if (back !== undefined) {
        void navigate('/');
      }
    },
    [marks, navigate, settle, space, undoDelete],
  );

  const showInTree = useCallback(
    (folder: string) => {
      setQuery('');
      ancestorsOf(folder).slice(1).forEach(openFolder);
      revealTree();
    },
    [openFolder, revealTree, setQuery],
  );

  const newNote = useCallback(
    (folder: string) => {
      const taken = new Set(childrenOf(latestTree.current, folder).map((node) => basenameOf(node.path).toLowerCase()));
      if (!phone) {
        showInTree(folder);
      }
      void navigate(draftUrl(joinPath(folder, freeName('untitled.md', taken))));
    },
    [navigate, phone, showInTree],
  );

  const newFolder = useCallback(
    (parent: string) => {
      if (phone) {
        const list = directoryUrl(parent);
        if (!shown.current.onFolder || shown.current.path !== parent) {
          void navigate(list);
        }
      } else {
        showInTree(parent);
      }
      setDraft({ parent });
    },
    [navigate, phone, showInTree],
  );

  const cancelDraft = useCallback(() => setDraft(undefined), []);

  useEffect(() => {
    if (!phone) {
      return;
    }
    const here = contentPathOf(location.pathname);
    const listed = isDirectoryPath(location.pathname) || here === '';
    setDraft((prev) => (prev !== undefined && listed && prev.parent === here ? prev : undefined));
  }, [location.pathname, phone]);

  const createFolder = useCallback(
    async (parent: string, name: string): Promise<boolean> => {
      const slug = slugPath(name);
      if (slug === '') {
        showToast('error', { message: 'A folder needs a letter or a digit in its name' });
        return false;
      }
      let res: EntryPathResponse;
      try {
        res = await api.createEntry(joinPath(parent, slug), 'dir');
      } catch (error) {
        showToast('error', { title: 'Nothing was created', message: conflictText(error, 'That folder already exists') });
        return false;
      }
      marks.touch([res.path]);
      refreshTree();
      reportMutation(res, `Created folder ${quoted(res.path, space)}`);
      openFolder(res.path);
      await navigate(directoryUrl(res.path));
      return true;
    },
    [marks, navigate, openFolder, refreshTree, reportMutation, space],
  );

  const submitDraft = useCallback(
    async (name: string): Promise<boolean> => {
      if (draft === undefined) {
        return false;
      }
      const created = await createFolder(draft.parent, name);
      if (created) {
        setDraft(undefined);
      }
      return created;
    },
    [createFolder, draft],
  );

  useEffect(() => {
    if (!canWrite) {
      return undefined;
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key.toLowerCase() !== 'n' || event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }
      if (!plainShortcut(event) || isEditPath(shown.current.route)) {
        return;
      }
      event.preventDefault();
      const { path, onFolder: folderShown } = shown.current;
      const folder = folderFor(path, path === '' || folderShown);
      if (event.shiftKey) {
        newFolder(folder);
      } else {
        newNote(folder);
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [canWrite, newFolder, newNote]);

  const moveInto = useCallback(
    (paths: readonly string[], folder: string) => {
      const report = async (
        { done, failure, changed, state }: Relocated, back: boolean, action?: ToastAction,
      ): Promise<void> => {
        const words = back ? failedMoveWords.back : failedMoveWords.forward;
        if (done.length > 0) {
          refreshTree();
          parentsOf(done).forEach(openFolder);
          reportMutation(
            state,
            movedMessage(done, back, space, (folder) => void navigate(directoryUrl(folder))),
            action,
          );
          const here = done
            .map((step) => pathAfterMove(shown.current.path, step.from, step.to))
            .find((moved) => moved !== undefined);
          relocateDrafts(done, here !== undefined);
          if (here !== undefined) {
            await navigate(shown.current.onFolder ? directoryUrl(here) : documentUrl(here));
          }
        }
        if (changed || failure !== undefined) {
          showToast('error', {
            title: done.length > 0 ? words.partly : words.none,
            message: changed ? changedSinceText : conflictText(failure, takenText),
          });
        }
      };
      const undoAction = (undo: MoveUndo): ToastAction => ({
        label: 'Undo',
        onClick: async () => {
          if (undo.stale) {
            showToast('error', { title: failedMoveWords.back.none, message: changedSinceText });
            return true;
          }
          return undo.run((res) => report(res, true));
        },
        onClose: () => undo.close(),
      });
      void marks
        .move(paths.map((from) => ({ from, to: joinPath(folder, basenameOf(from)) })))
        .then((res) => report(res, false, res.undo === undefined ? undefined : undoAction(res.undo)));
    },
    [marks, navigate, openFolder, refreshTree, relocateDrafts, reportMutation, space],
  );

  const submitRename = useCallback(
    async (path: string, isDir: boolean, name: string): Promise<boolean> => {
      const problem = nameProblem(name);
      if (problem !== undefined) {
        showToast('error', { title: notRenamedTitle, message: problem });
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
        showToast('error', { title: notRenamedTitle, message: conflictText(error, takenText) });
        return false;
      }
      marks.touch([path, res.path]);
      reportMutation(res, renamedMessage(path, res.path, isDir, space));
      const here = pathAfterMove(shown.current.path, path, res.path);
      relocateDrafts([{ from: path, to: res.path }], here !== undefined);
      if (here !== undefined) {
        const url = shown.current.onFolder ? directoryUrl(here) : documentUrl(here);
        followed.current = { path, url };
        await navigate(url);
        return true;
      }
      refreshTree();
      return true;
    },
    [marks, navigate, refreshTree, relocateDrafts, reportMutation, space],
  );

  const startRename = useCallback(
    (path: string, isDir: boolean, place: RenamePlace) => {
      if (place === 'tree') {
        showInTree(parentOf(path));
      }
      renameSessions.current += 1;
      setRenaming({ id: renameSessions.current, path, isDir, place });
    },
    [showInTree],
  );

  const endRename = useCallback((id: number) => setRenaming((prev) => (prev?.id === id ? undefined : prev)), []);

  const actions = useMemo<FileActions>(
    () => ({
      newNote,
      newFolder,
      renaming,
      startRename,
      endRename,
      renameCommit,
      submitRename,
      moveTo: (path, anchor) => setMoving({ path, anchor }),
      remove,
      copyLink: (path, isDir) => void copyLink(path, isDir),
      moveInto,
      draft,
      submitDraft,
      cancelDraft,
      createFolder,
    }),
    [cancelDraft, copyLink, createFolder, draft, endRename, moveInto, newFolder, newNote, remove, renaming, startRename, submitDraft, submitRename],
  );

  return (
    <FileActionsContext.Provider value={actions}>
      {children}

      {moving !== undefined && (
        <MoveDialog
          path={moving.path}
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
