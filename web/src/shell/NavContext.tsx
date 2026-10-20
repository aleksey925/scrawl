import {
  createContext, useCallback, useContext, useEffect, useMemo, useState,
  type JSX, type ReactNode,
} from 'react';
import { useLocation } from 'react-router';

import type { MeResponse, NavNode } from '../api/types';
import { answerKeys, forgetResponses, useApi } from '../api/useApi';
import { usePlatform } from '../platform';

import { contentPathOf } from './naming';
import { syncMessage, type SyncMessage } from './syncMessage';
import type { MeState } from './useMe';

// one bucket per space: the set is read during the very first render, long
// before /api/me has answered, so the key comes from the platform's scope and
// not from the space name the server reports.
//
// v2 because the space's own row joined the tree: a set written before it
// existed holds no entry for the root and would open on a collapsed space.
function openKey(scope: string): string {
  return `scrawl.tree.open:v2:${scope}`;
}

// the space row starts open, because a tree whose only row is the space is
// not a tree. Collapsing it is remembered like any other folder.
const rootPath = '';

function readOpen(storageKey: string): ReadonlySet<string> {
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

function writeOpen(storageKey: string, open: ReadonlySet<string>): void {
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
  // currentPath is the route's content path, which is the file on screen: a
  // folder is always its list, so a note is shown under its own address only
  currentPath: string;
  // the space's own state, resolved once so the banner and the sync control
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

export interface NavProviderProps {
  // the space's state, kept fresh by whoever knows where it comes from
  status: MeState;
  children: ReactNode;
}

export function NavProvider({ status, children }: NavProviderProps): JSX.Element {
  const location = useLocation();
  const currentPath = contentPathOf(location.pathname);

  const [token, setToken] = useState(0);
  const { source, storageScope } = usePlatform();
  const storageKey = openKey(storageScope);
  const nav = useApi((signal) => source.nav(currentPath, { signal }), [source, currentPath, token], answerKeys.nav(currentPath));
  const { me, refreshMe } = status;

  const [open, setOpen] = useState<ReadonlySet<string>>(() => readOpen(storageKey));
  const [query, setQuery] = useState('');
  const tree = useMemo(() => nav.data?.tree ?? [], [nav.data]);

  useEffect(() => {
    setOpen((prev) => {
      const next = new Set(prev);
      const before = next.size;
      activeFolders(tree, next);
      if (next.size === before) {
        return prev;
      }
      writeOpen(storageKey, next);
      return next;
    });
  }, [tree, storageKey]);

  const toggleFolder = useCallback((path: string) => {
    setOpen((prev) => {
      const next = new Set(prev);
      if (!next.delete(path)) {
        next.add(path);
      }
      writeOpen(storageKey, next);
      return next;
    });
  }, [storageKey]);

  const openFolder = useCallback((path: string) => {
    setOpen((prev) => {
      if (prev.has(path)) {
        return prev;
      }
      const next = new Set(prev).add(path);
      writeOpen(storageKey, next);
      return next;
    });
  }, [storageKey]);

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
    const paths = me?.space.unsynced;
    if (paths === undefined || paths.many) {
      return undefined;
    }
    return new Set(paths.paths);
  }, [me?.space.unsynced]);
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
      tree, nav.error, nav.loading, me, currentPath, sync, isUnsynced,
      refreshNav, refreshMe, isOpen, toggleFolder, openFolder, query,
    ],
  );

  return <NavContext.Provider value={value}>{children}</NavContext.Provider>;
}
