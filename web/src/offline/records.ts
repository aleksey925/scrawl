import { dataCache, spaceKey, stateKey } from './keys';

export type CopyError = '' | 'quota' | 'failed';

export interface CopyState {
  owner: string;
  updatedAt: number;
  error: CopyError;
}

export type EntryKind = 'dir' | 'note' | 'file' | 'nav' | 'me';

export interface StoredEntry {
  kind: EntryKind;
  version: string;
  release: string;
}

export interface SpaceRecord {
  etag: string;
  entries: Record<string, StoredEntry>;
}

export const navEntry = '/nav';

export const meEntry = '/me';

async function readRecord<T>(key: string): Promise<T | undefined> {
  const stored = await caches.match(key, { cacheName: dataCache });
  return stored === undefined ? undefined : ((await stored.json()) as T);
}

async function writeRecord(cache: Cache, key: string, value: unknown): Promise<void> {
  await cache.put(key, new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } }));
}

export function readState(): Promise<CopyState | undefined> {
  return readRecord<CopyState>(stateKey);
}

export function writeState(cache: Cache, state: CopyState): Promise<void> {
  return writeRecord(cache, stateKey, state);
}

export function readSpace(name: string): Promise<SpaceRecord | undefined> {
  return readRecord<SpaceRecord>(spaceKey(name));
}

export function writeSpace(cache: Cache, name: string, record: SpaceRecord): Promise<void> {
  return writeRecord(cache, spaceKey(name), record);
}
