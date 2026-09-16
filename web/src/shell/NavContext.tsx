import {
  createContext, useCallback, useContext, useEffect, useMemo, useState,
  type JSX, type ReactNode,
} from 'react';
import { useLocation } from 'react-router';

import { api } from '../api/client';
import type { MeResponse, NavNode } from '../api/types';
import { useApi } from '../api/useApi';
import { mountBase } from '../mount';

import { contentPathOf } from './naming';

// one bucket per project: the set is read during the very first render, long
// before /api/me has answered, so the key comes from the mount prefix and not
// from the project name the server reports
const storageKey = `scrawl.tree.open:${mountBase()}`;

function readOpen(): ReadonlySet<string> {
  try {
    const raw = localStorage.getItem(storageKey);
    const parsed: unknown = raw === null ? [] : JSON.parse(raw);
    return new Set(Array.isArray(parsed) ? parsed.filter((path): path is string => typeof path === 'string') : []);
  } catch {
    return new Set();
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
  currentPath: string;
  refresh: () => void;
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
  const nav = useApi((signal) => api.nav(currentPath, { signal }), [currentPath, token]);
  const me = useApi((signal) => api.me({ signal }), [token]);

  const [open, setOpen] = useState<ReadonlySet<string>>(readOpen);
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
  const refresh = useCallback(() => setToken((seen) => seen + 1), []);

  const value = useMemo<NavState>(() => {
    const account = me.data;
    return {
      tree,
      error: nav.error,
      loading: nav.loading,
      me: account,
      // a write the server would refuse is never offered: read-only mode and,
      // where auth is on, a reader who has not signed in
      canWrite: account !== undefined && !account.read_only && (!account.auth_on || account.user !== ''),
      currentPath,
      refresh,
      isOpen,
      toggleFolder,
      openFolder,
      query,
      setQuery,
    };
  }, [tree, nav.error, nav.loading, me.data, currentPath, refresh, isOpen, toggleFolder, openFolder, query]);

  return <NavContext.Provider value={value}>{children}</NavContext.Provider>;
}
