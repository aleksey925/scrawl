import { useCallback, useSyncExternalStore } from 'react';

import { usePlatform } from '../platform';
import { localStore, readJson, writeJson } from '../storage';

// RecentNote is a note opened on this device
export interface RecentNote {
  path: string;
  title: string;
}

const maxRecent = 8;

const listeners = new Set<() => void>();
const cache = new Map<string, readonly RecentNote[]>();

function keyOf(scope: string): string {
  return `scrawl.recent:${scope}`;
}

function read(scope: string): readonly RecentNote[] {
  let res = cache.get(scope);
  if (res === undefined) {
    const stored = readJson<unknown>(localStore(), keyOf(scope));
    res = Array.isArray(stored)
      ? stored.filter(
          (entry): entry is RecentNote =>
            typeof entry === 'object' && entry !== null && typeof (entry as RecentNote).path === 'string',
        )
      : [];
    cache.set(scope, res);
  }
  return res;
}

function write(scope: string, notes: readonly RecentNote[]): void {
  cache.set(scope, notes);
  writeJson(localStore(), keyOf(scope), notes);
  for (const listener of listeners) {
    listener();
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export interface RecentNotes {
  notes: readonly RecentNote[];
  remember: (note: RecentNote) => void;
  clear: () => void;
}

// useRecentNotes is the notes opened on this device, newest first, kept per
// space in the browser: one reader's convenience, which a private window may
// refuse to keep
export function useRecentNotes(): RecentNotes {
  const { storageScope } = usePlatform();
  const notes = useSyncExternalStore(subscribe, () => read(storageScope));
  const remember = useCallback(
    (note: RecentNote) => {
      const rest = read(storageScope).filter((entry) => entry.path !== note.path);
      write(storageScope, [note, ...rest].slice(0, maxRecent));
    },
    [storageScope],
  );
  const clear = useCallback(() => write(storageScope, []), [storageScope]);
  return { notes, remember, clear };
}
