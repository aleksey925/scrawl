import {
  createContext, useCallback, useContext, useEffect, useMemo, useState,
  type JSX, type ReactNode,
} from 'react';
import { useLocation } from 'react-router';

import { api } from '../api/client';
import type { MeResponse, NavNode } from '../api/types';
import { forgetResponses, useApi } from '../api/useApi';
import { mountBase } from '../mount';

import { contentPathOf } from './naming';
import { syncMessage, type SyncMessage } from './syncMessage';
import { useMe } from './useMe';

// one bucket per project: the set is read during the very first render, long
// before /api/me has answered, so the key comes from the mount prefix and not
// from the project name the server reports.
//
// v2 because the project's own row joined the tree: a set written before it
// existed holds no entry for the root and would open on a collapsed project.
const storageKey = `scrawl.tree.open:v2:${mountBase()}`;

// the project row starts open, because a tree whose only row is the project is
// not a tree. Collapsing it is remembered like any other folder.
const rootPath = '';

function readOpen(): ReadonlySet<string> {
  try {
    const raw = localStorage.getItem(storageKey);
    if (raw === null) {
      return new Set([rootPath]);
    }
    const parsed: unknown = JSON.parse(raw);
    return new Set(Array.isArray(parsed) ? parsed.filter((path): path is string => typeof path === 'string') : []);
  } catch {
    return new Set([rootPath]);
  }
}

function writeOpen(open: ReadonlySet<string>): void {
  try {
    localStorage.setItem(storageKey, JSON.stringify([...open]));
  } catch {
    // private mode, the tree just will not remember which folders were open
  }
}

export interface NavState {
  tree: readonly NavNode[];
  error: unknown;
  loading: boolean;
  me: MeResponse | undefined;
  canWrite: boolean;
  // currentPath is the route's content path, which is what the tree and the
  // breadcrumbs want. currentDoc is the file on screen, which is not the same
  // thing: a directory holding an index.md is served under the directory's own
  // address, and the root is that case with an empty path.
  currentPath: string;
  currentDoc: string;
  // the project's own state, resolved once so the banner and the sync control
  // render the same words
  sync: SyncMessage | undefined;
  isUnsynced: (path: string) => boolean;
  // two refreshes, because they cost different things: the tree is a full walk
  // of the store and drops every cached answer with it, me is one small read
  refreshNav: () => void;
  refreshMe: () => void;
  isOpen: (path: string) => boolean;
  toggleFolder: (path: string) => void;
  openFolder: (path: string) => void;
  query: string;
  setQuery: (query: string) => void;
}

const NavContext = createContext<NavState | undefined>(undefined);

export function useNav(): NavState {
  const state = useContext(NavContext);
  if (state === undefined) {
    throw new Error('navigation state is only available inside the app shell');
  }
  return state;
}

function activeFolders(nodes: readonly NavNode[], into: Set<string>): void {
  for (const node of nodes) {
    if (node.is_dir && node.active) {
      into.add(node.path);
    }
    activeFolders(node.children, into);
  }
}

export function NavProvider({ children }: { children: ReactNode }): JSX.Element {
  const location = useLocation();
  const currentPath = contentPathOf(location.pathname);

  const [token, setToken] = useState(0);
  const nav = useApi((signal) => api.nav(currentPath, { signal }), [currentPath, token], `nav:${currentPath}`);
  const { me, refreshMe } = useMe();

  const [open, setOpen] = useState<ReadonlySet<string>>(readOpen);
  const [query, setQuery] = useState('');
  // the file a document registered, empty while none is mounted
  const [mountedDoc, setMountedDoc] = useState('');

  const tree = useMemo(() => nav.data?.tree ?? [], [nav.data]);

  useEffect(() => {
    setOpen((prev) => {
      const next = new Set(prev);
      const before = next.size;
      activeFolders(tree, next);
      if (next.size === before) {
        return prev;
      }
      writeOpen(next);
      return next;
    });
  }, [tree]);

  const toggleFolder = useCallback((path: string) => {
    setOpen((prev) => {
      const next = new Set(prev);
      if (!next.delete(path)) {
        next.add(path);
      }
      writeOpen(next);
      return next;
    });
  }, []);

  const openFolder = useCallback((path: string) => {
    setOpen((prev) => {
      if (prev.has(path)) {
        return prev;
      }
      const next = new Set(prev).add(path);
      writeOpen(next);
      return next;
    });
  }, []);

  const isOpen = useCallback((path: string) => open.has(path), [open]);
  const refreshNav = useCallback(() => {
    // the tree moved, so a directory listing or a rendered note may have too,
    // and a screen painting from a cached one would be showing the old shape
    forgetResponses();
    setToken((seen) => seen + 1);
  }, []);

  const sync = useMemo(() => syncMessage(me), [me]);

  // isUnsynced answers false for every path once the set was dropped above the
  // cap, so the degraded form draws no badges by construction rather than by
  // every surface remembering to check
  const unsynced = useMemo(() => {
    const paths = me?.project.unsynced;
    if (paths === undefined || paths.many) {
      return undefined;
    }
    return new Set(paths.paths);
  }, [me?.project.unsynced]);
  const isUnsynced = useCallback((path: string) => unsynced?.has(path) ?? false, [unsynced]);

  const value = useMemo<NavState>(
    () => ({
      tree,
      error: nav.error,
      loading: nav.loading,
      me,
      // a write the server would refuse is never offered: read-only mode and,
      // where auth is on, a reader who has not signed in
      canWrite: me !== undefined && !me.read_only && (!me.auth_on || me.user !== ''),
      currentPath,
      // no document mounted means /edit/ or /history/, whose routes do name
      // the file
      currentDoc: mountedDoc === '' ? currentPath : mountedDoc,
      sync,
      isUnsynced,
      refreshNav,
      refreshMe,
      isOpen,
      toggleFolder,
      openFolder,
      query,
      setQuery,
    }),
    [
      tree, nav.error, nav.loading, me, currentPath, mountedDoc, sync, isUnsynced,
      refreshNav, refreshMe, isOpen, toggleFolder, openFolder, query,
    ],
  );

  return (
    <NavContext.Provider value={value}>
      <MountedDocContext.Provider value={setMountedDoc}>{children}</MountedDocContext.Provider>
    </NavContext.Provider>
  );
}

// MountedDocContext is how a document tells the shell which file it is. It is
// separate from NavContext so that registering does not re-render everything
// that reads the navigation state.
const MountedDocContext = createContext<((path: string) => void) | undefined>(undefined);

// useCurrentDoc registers the file being rendered. DocumentBody is the only
// caller, and that covers every case: it is the one component that renders a
// document, from the document route and from the directory route when the
// folder has an index.
//
// It matters because the route path is not the file whenever a directory is
// served as its index.md - the root above all, which is the page most readers
// are looking at. A per-file signal keyed off the route would stay silent about
// the very note on screen.
export function useCurrentDoc(docPath: string): void {
  const setMountedDoc = useContext(MountedDocContext);
  useEffect(() => {
    setMountedDoc?.(docPath);
    // React runs the cleanup of the old document before the effect of the new
    // one, so the value never points at the note the reader just left
    return () => setMountedDoc?.('');
  }, [docPath, setMountedDoc]);
}
