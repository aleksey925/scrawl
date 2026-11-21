import { useCallback, useSyncExternalStore } from 'react';

import { changeSignal } from '../changeSignal';
import { usePlatform } from '../platform';
import { localStore, readJson, writeJson } from '../storage';

export interface RecentNote {
  path: string;
  title: string;
}

const maxRecent = 8;

const changes = changeSignal();
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
  changes.notify();
}

export interface RecentNotes {
  notes: readonly RecentNote[];
  clear: () => void;
}

export function useRecentNotes(): RecentNotes {
  const { storageScope } = usePlatform();
  const notes = useSyncExternalStore(changes.subscribe, () => read(storageScope));
  const clear = useCallback(() => write(storageScope, []), [storageScope]);
  return { notes, clear };
}

export function useRememberRecent(): (note: RecentNote) => void {
  const { storageScope } = usePlatform();
  return useCallback(
    (note: RecentNote) => {
      const notes = read(storageScope);
      if (notes[0]?.path === note.path && notes[0].title === note.title) {
        return;
      }
      const rest = notes.filter((entry) => entry.path !== note.path);
      write(storageScope, [note, ...rest].slice(0, maxRecent));
    },
    [storageScope],
  );
}
