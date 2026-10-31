import {
  createContext, useCallback, useContext, useEffect, useMemo, useState,
  type JSX, type ReactNode,
} from 'react';
import { useLocation } from 'react-router';

import type { MeResponse, NavNode } from '../api/types';
import { answerKeys, forgetResponses, useApi } from '../api/useApi';
import { usePlatform } from '../platform';
import { localStore, readJson, writeJson } from '../storage';

import { contentPathOf } from './naming';
import { syncMessage, type SyncMessage } from './syncMessage';
import type { MeState } from './useMe';

function openKey(scope: string): string {
  return `scrawl.tree.open:v2:${scope}`;
}

function readOpen(storageKey: string): ReadonlySet<string> {
  const parsed = readJson<unknown>(localStore(), storageKey);
  return new Set(Array.isArray(parsed) ? parsed.filter((path): path is string => typeof path === 'string') : []);
}

function writeOpen(storageKey: string, open: ReadonlySet<string>): void {
  writeJson(localStore(), storageKey, [...open]);
}

export interface NavState {
  tree: readonly NavNode[];
  error: unknown;
  loading: boolean;
  me: MeResponse | undefined;
  canWrite: boolean;
  currentPath: string;
  sync: SyncMessage | undefined;
  isUnsynced: (path: string) => boolean;
  refreshNav: () => void;
  refreshMe: () => void;
  changes: number;
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

export function spaceLabel(me: MeResponse | undefined): string {
  return me?.space.label ?? me?.site_title ?? 'Notes';
}

function activeFolders(nodes: readonly NavNode[], into: Set<string>): void {
  for (const entry of nodes) {
    if (entry.is_dir && entry.active) {
      into.add(entry.path);
    }
    activeFolders(entry.children, into);
  }
}

export interface NavProviderProps {
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
    forgetResponses();
    setToken((seen) => seen + 1);
  }, []);

  const sync = useMemo(() => syncMessage(me), [me]);

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
      canWrite: me !== undefined && !me.read_only && (!me.auth_on || me.user !== ''),
      currentPath,
      sync,
      isUnsynced,
      refreshNav,
      refreshMe,
      changes: token,
      isOpen,
      toggleFolder,
      openFolder,
      query,
      setQuery,
    }),
    [
      tree, nav.error, nav.loading, me, currentPath, sync, isUnsynced,
      refreshNav, refreshMe, token, isOpen, toggleFolder, openFolder, query,
    ],
  );

  return <NavContext.Provider value={value}>{children}</NavContext.Provider>;
}
