import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
  type JSX, type ReactNode,
} from 'react';
import { useLocation } from 'react-router';

import type { MeResponse, NavNode } from '../api/types';
import { answerKeys, forgetResponses, useApi } from '../api/useApi';
import { usePlatform } from '../platform';
import { localStore, readJson, writeJson } from '../storage';

import { contentPathOf } from './naming';
import { syncMessage, syncStatusOf, type SyncMessage, type SyncStatus } from './syncMessage';
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

export interface AccountState {
  me: MeResponse | undefined;
  canWrite: boolean;
  sync: SyncMessage | undefined;
  syncStatus: SyncStatus | undefined;
  isUnsynced: (path: string) => boolean;
  refreshMe: () => void;
}

export interface TreeState {
  tree: readonly NavNode[];
  error: unknown;
  loading: boolean;
  currentPath: string;
  refreshTree: () => void;
  changes: number;
  isOpen: (path: string) => boolean;
  toggleFolder: (path: string) => void;
  openFolder: (path: string) => void;
  setQuery: (query: string) => void;
}

const AccountContext = createContext<AccountState | undefined>(undefined);

const TreeContext = createContext<TreeState | undefined>(undefined);

const TreeQueryContext = createContext('');

export function useAccount(): AccountState {
  const state = useContext(AccountContext);
  if (state === undefined) {
    throw new Error('the account is only available inside the app shell');
  }
  return state;
}

export function useTree(): TreeState {
  const state = useContext(TreeContext);
  if (state === undefined) {
    throw new Error('the tree is only available inside the app shell');
  }
  return state;
}

export function useTreeQuery(): string {
  return useContext(TreeQueryContext);
}

export function spaceLabel(me: MeResponse | undefined): string {
  return me?.space.label ?? me?.site_title ?? 'Notes';
}

const noNodes: readonly NavNode[] = [];

function foldersOnPath(nodes: readonly NavNode[], current: string, into: Set<string>): void {
  for (const entry of nodes) {
    if (entry.is_dir && (entry.path === current || current.startsWith(`${entry.path}/`))) {
      into.add(entry.path);
      foldersOnPath(entry.children, current, into);
    }
  }
}

function folderFill(nodes: readonly NavNode[], into: Map<string, boolean>): void {
  for (const entry of nodes) {
    if (entry.is_dir) {
      into.set(entry.path, entry.children.length === 0);
      folderFill(entry.children, into);
    }
  }
}

function fillChanges(before: ReadonlyMap<string, boolean>, after: ReadonlyMap<string, boolean>): {
  filled: string[];
  emptied: string[];
} {
  const filled: string[] = [];
  const emptied: string[] = [];
  for (const [path, empty] of after) {
    const wasEmpty = before.get(path);
    if (wasEmpty === true && !empty) {
      filled.push(path);
    } else if (wasEmpty === false && empty) {
      emptied.push(path);
    }
  }
  return { filled, emptied };
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
  const nav = useApi((signal) => source.nav({ signal }), [source, currentPath, token], answerKeys.nav, {
    keepEqual: true,
  });
  const { me, refreshMe } = status;

  const [open, setOpen] = useState<ReadonlySet<string>>(() => readOpen(storageKey));
  const [query, setQuery] = useState('');
  const tree = nav.data?.tree ?? noNodes;
  const loading = nav.loading && nav.data === undefined;

  const seenOnPath = useRef<{ page: string; folders: ReadonlySet<string> }>({ page: '', folders: new Set() });
  useEffect(() => {
    const onPath = new Set<string>();
    foldersOnPath(tree, currentPath, onPath);
    const seen = seenOnPath.current.page === currentPath ? seenOnPath.current.folders : new Set<string>();
    const arrived = [...onPath].filter((path) => !seen.has(path));
    seenOnPath.current = { page: currentPath, folders: onPath };
    if (arrived.length === 0) {
      return;
    }
    setOpen((prev) => {
      const next = new Set([...prev, ...arrived]);
      if (next.size === prev.size) {
        return prev;
      }
      writeOpen(storageKey, next);
      return next;
    });
  }, [tree, currentPath, storageKey]);

  const lastFill = useRef<ReadonlyMap<string, boolean> | undefined>(undefined);
  useEffect(() => {
    if (nav.loading || nav.data === undefined) {
      return;
    }
    const fill = new Map<string, boolean>();
    folderFill(tree, fill);
    const before = lastFill.current;
    lastFill.current = fill;
    if (before === undefined) {
      return;
    }
    const { filled, emptied } = fillChanges(before, fill);
    if (filled.length === 0 && emptied.length === 0) {
      return;
    }
    setOpen((prev) => {
      if (filled.every((path) => prev.has(path)) && emptied.every((path) => !prev.has(path))) {
        return prev;
      }
      const next = new Set(prev);
      filled.forEach((path) => next.add(path));
      emptied.forEach((path) => next.delete(path));
      writeOpen(storageKey, next);
      return next;
    });
  }, [tree, nav.loading, nav.data, storageKey]);

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
  const refreshTree = useCallback(() => {
    forgetResponses();
    setToken((seen) => seen + 1);
  }, []);

  const sync = useMemo(() => syncMessage(me), [me]);
  const syncStatus = useMemo(() => syncStatusOf(me, sync), [me, sync]);

  const unsynced = useMemo(() => {
    const paths = me?.space.unsynced;
    if (paths === undefined || paths.many) {
      return undefined;
    }
    return new Set(paths.paths);
  }, [me?.space.unsynced]);
  const isUnsynced = useCallback((path: string) => unsynced?.has(path) ?? false, [unsynced]);

  const account = useMemo<AccountState>(
    () => ({
      me,
      canWrite: me !== undefined && !me.read_only && (!me.auth_on || me.user !== ''),
      sync,
      syncStatus,
      isUnsynced,
      refreshMe,
    }),
    [me, sync, syncStatus, isUnsynced, refreshMe],
  );

  const treeState = useMemo<TreeState>(
    () => ({
      tree,
      error: nav.error,
      loading,
      currentPath,
      refreshTree,
      changes: token,
      isOpen,
      toggleFolder,
      openFolder,
      setQuery,
    }),
    [tree, nav.error, loading, currentPath, refreshTree, token, isOpen, toggleFolder, openFolder],
  );

  return (
    <AccountContext.Provider value={account}>
      <TreeContext.Provider value={treeState}>
        <TreeQueryContext.Provider value={query}>{children}</TreeQueryContext.Provider>
      </TreeContext.Provider>
    </AccountContext.Provider>
  );
}
