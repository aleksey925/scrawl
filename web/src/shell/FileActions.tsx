import {
  useCallback, useEffect, useMemo, useRef, useState,
  type JSX, type ReactNode,
} from 'react';
import { useLocation, useNavigate } from 'react-router';

import { api } from '../api/client';
import { ApiError } from '../api/errors';
import type { DeleteResponse, DirEntry, EntryPathResponse, MutationState, NavNode } from '../api/types';
import { errorText } from '../api/useApi';
import { mountBase } from '../mount';
import { copyText } from '../reader/clipboard';
import { directoryUrl, documentUrl, draftUrl, isDirectoryPath, isEditPath, isMarkdown, slugPath } from '../paths';
import { layoutBreakpoints, useBelow } from '../theme';
import { showToast, ToastLink, type ToastAction } from '../toast';

import { FileActionsContext, type FileActions, type FolderDraft, type RenamePlace, type Renaming } from './fileActionsContext';
import { MoveDialog } from './MoveDialog';
import { useReaderLayout } from './ReaderLayout';
import { spaceLabel, useNav } from './NavContext';
import { useMutationState } from './useMutationState';
import { ancestorsOf, basenameOf, contentPathOf, folderFor, freeName, joinPath, nameProblem, parentOf, renamedPath } from './naming';
import { plainShortcut } from './shortcuts';

interface MovedEntry {
  path: string;
  anchor: DOMRect;
}

interface Relocation {
  from: string;
  to: string;
}

interface UndoMark {
  targets: string[];
  stamps: Map<string, Promise<string | undefined>>;
}

const changedSinceText = 'It was renamed, moved or deleted since';

const notRenamedTitle = 'Nothing was renamed';

const takenText = 'Something of that name is already there';

const failedMoveWords = {
  forward: { partly: 'Some of it did not move', none: 'Nothing was moved' },
  back: { partly: 'Some of it did not move back', none: 'Nothing was moved back' },
};

function quoted(path: string, spaceName: string): string {
  return `"${path === '' ? spaceName : basenameOf(path)}"`;
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
  const [folder, ...others] = new Set(done.map((pair) => parentOf(pair.to)));
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

function stampOf(entry: DirEntry): string {
  return entry.is_dir ? 'dir' : `${entry.size}:${entry.mod_time}`;
}

async function stampAt(path: string): Promise<string | undefined> {
  const listing = await api.dir(parentOf(path));
  const found = listing.entries.find((row) => row.path === path);
  return found === undefined ? undefined : stampOf(found);
}

async function stampOrUnknown(path: string): Promise<string | undefined> {
  try {
    return await stampAt(path);
  } catch {
    return undefined;
  }
}

async function unchanged(path: string, was: string | undefined): Promise<boolean> {
  if (was === undefined) {
    return true;
  }
  try {
    return (await stampAt(path)) === was;
  } catch {
    return true;
  }
}

interface Relocated {
  done: Relocation[];
  left: Relocation[];
  failure: unknown;
  changed: boolean;
  state: MutationState;
}

async function relocateAll(
  pairs: readonly Relocation[], valid: (pair: Relocation) => Promise<boolean>, onMoved?: (path: string) => void,
): Promise<Relocated> {
  const res: Relocated = { done: [], left: [], failure: undefined, changed: false, state: {} };
  for (const pair of pairs) {
    if (!(await valid(pair))) {
      res.left.push(pair);
      res.changed = true;
      continue;
    }
    let moved: EntryPathResponse;
    try {
      moved = await api.move(pair.from, pair.to);
    } catch (error) {
      res.left.push(pair);
      res.failure = error;
      continue;
    }
    onMoved?.(moved.path);
    res.done.push({ ...pair, to: moved.path });
    res.state = {
      unpublished: res.state.unpublished === true || moved.unpublished === true,
      history_degraded: res.state.history_degraded === true || moved.history_degraded === true,
    };
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

function childrenOf(tree: readonly NavNode[], folder: string): readonly NavNode[] {
  let nodes = tree;
  for (const step of ancestorsOf(folder).slice(1)) {
    nodes = nodes.find((node) => node.path === step)?.children ?? [];
  }
  return nodes;
}

function replaces(path: string, target: string): boolean {
  return target === path || target.startsWith(`${path}/`);
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
  const { tree, me, currentPath, canWrite, refreshNav, refreshMe, openFolder, setQuery } = useNav();
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
  const undoable = useRef(new Set<UndoMark>());

  useEffect(() => {
    const follow = followed.current;
    followed.current = undefined;
    setRenaming((prev) =>
      prev !== undefined && follow?.url === location.pathname && !replaces(follow.path, prev.path) ? prev : undefined,
    );
  }, [location.pathname]);

  const touch = useCallback((paths: readonly string[], keep?: UndoMark) => {
    for (const mark of undoable.current) {
      if (mark !== keep && mark.targets.some((target) => paths.some((path) => replaces(path, target)))) {
        undoable.current.delete(mark);
      }
    }
  }, []);

  const copyLink = useCallback(async (path: string, isDir: boolean): Promise<void> => {
    if (await copyText(appUrl(path, isDir))) {
      showToast('ok', { message: `Copied the link to ${quoted(path, space)}` });
    } else {
      showToast('error', { message: 'Could not copy the link' });
    }
  }, [space]);

  const settle = useCallback(() => {
    refreshMe();
    refreshNav();
  }, [refreshMe, refreshNav]);

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
      refreshNav();
      if (back !== undefined) {
        await navigate(back);
      }
      return true;
    },
    [navigate, refreshNav, reportMutation, space],
  );

  const remove = useCallback(
    (path: string) => {
      const { path: here, route } = shown.current;
      const back = here === path || here.startsWith(`${path}/`) ? route : undefined;
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
      touch([path]);
      showToast('ok', {
        message: `Deleted ${quoted(path, space)}`,
        action: { label: 'Undo', onClick: () => undoDelete(deleting, path, back) },
      });
      if (back !== undefined) {
        void navigate('/');
      }
    },
    [navigate, settle, space, touch, undoDelete],
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
      const taken = new Set(childrenOf(tree, folder).map((node) => basenameOf(node.path).toLowerCase()));
      if (!phone) {
        showInTree(folder);
      }
      void navigate(draftUrl(joinPath(folder, freeName('untitled.md', taken))));
    },
    [navigate, phone, showInTree, tree],
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
      touch([res.path]);
      refreshNav();
      reportMutation(res, `Created folder ${quoted(res.path, space)}`);
      openFolder(res.path);
      await navigate(directoryUrl(res.path));
      return true;
    },
    [navigate, openFolder, refreshNav, reportMutation, space, touch],
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
      if (event.key.toLowerCase() !== 'n' || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) {
        return;
      }
      if (!plainShortcut(event) || isEditPath(shown.current.route)) {
        return;
      }
      event.preventDefault();
      const { path, onFolder: folderShown } = shown.current;
      newNote(folderFor(path, path === '' || folderShown));
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [canWrite, newNote]);

  const moveInto = useCallback(
    (paths: readonly string[], folder: string) => {
      const stillMarked = async (mark: UndoMark, pair: Relocation): Promise<boolean> => {
        if (!(await unchanged(pair.from, await mark.stamps.get(pair.from)))) {
          undoable.current.delete(mark);
        }
        return undoable.current.has(mark);
      };
      const undoOf = (done: readonly Relocation[], mark: UndoMark): ToastAction => {
        let undo = done.map((pair) => ({ ...pair, from: pair.to, to: pair.from })).reverse();
        let running = false;
        let closed = false;
        return {
          label: 'Undo',
          onClick: async () => {
            if (!undoable.current.has(mark)) {
              showToast('error', { title: failedMoveWords.back.none, message: changedSinceText });
              return true;
            }
            running = true;
            undo = await run(undo, mark);
            running = false;
            mark.targets = undo.map((pair) => pair.from);
            if (undo.length === 0 || closed) {
              undoable.current.delete(mark);
            }
            return undo.length === 0;
          },
          onClose: () => {
            closed = true;
            if (!running) {
              undoable.current.delete(mark);
            }
          },
        };
      };
      const run = async (pairs: readonly Relocation[], undone?: UndoMark): Promise<Relocation[]> => {
        const back = undone !== undefined;
        const mark: UndoMark = undone ?? { targets: [], stamps: new Map() };
        if (!back) {
          undoable.current.add(mark);
        }
        const { done, left, failure, changed, state } = await relocateAll(
          pairs,
          async (pair) => !back || stillMarked(mark, pair),
          back ? undefined : (path) => {
            mark.targets.push(path);
            mark.stamps.set(path, stampOrUnknown(path));
          },
        );
        const words = back ? failedMoveWords.back : failedMoveWords.forward;
        if (done.length > 0) {
          touch(done.flatMap((pair) => [pair.from, pair.to]), mark);
          refreshNav();
          new Set(done.map((pair) => parentOf(pair.to))).forEach(openFolder);
          reportMutation(
            state,
            movedMessage(done, back, space, (folder) => void navigate(directoryUrl(folder))),
            back ? undefined : undoOf(done, mark),
          );
          const here = done.map((pair) => pathAfterMove(shown.current.path, pair.from, pair.to)).find((path) => path !== undefined);
          if (here !== undefined) {
            await navigate(shown.current.onFolder ? directoryUrl(here) : documentUrl(here));
          }
        } else if (!back) {
          undoable.current.delete(mark);
        }
        if (changed || failure !== undefined) {
          showToast('error', {
            title: done.length > 0 ? words.partly : words.none,
            message: changed ? changedSinceText : conflictText(failure, takenText),
          });
        }
        return left;
      };
      void run(
        paths.map((from) => ({ from, to: joinPath(folder, basenameOf(from)) })),
      );
    },
    [navigate, openFolder, refreshNav, reportMutation, space, touch],
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
      touch([path, res.path]);
      reportMutation(res, renamedMessage(path, res.path, isDir, space));
      const here = pathAfterMove(shown.current.path, path, res.path);
      if (here !== undefined) {
        const url = shown.current.onFolder ? directoryUrl(here) : documentUrl(here);
        followed.current = { path, url };
        await navigate(url);
        return true;
      }
      refreshNav();
      return true;
    },
    [navigate, refreshNav, reportMutation, space, touch],
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
