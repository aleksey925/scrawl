import { mountBase } from '../mount';

import { dataCache, decoded, runKey, spaceKey, stateKey } from './keys';

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

export function mountedSpace(): string {
  return decoded(mountBase().replace(/^\/s\//, ''));
}

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

export async function readSpace(name: string): Promise<SpaceRecord> {
  const stored = await readRecord<SpaceRecord>(spaceKey(name));
  const entries = Object.assign(Object.create(null) as Record<string, StoredEntry>, stored?.entries);
  return { etag: stored?.etag ?? '', entries };
}

export function writeSpace(cache: Cache, name: string, record: SpaceRecord): Promise<void> {
  return writeRecord(cache, spaceKey(name), record);
}

export interface RunRecord {
  url: string;
  offline: boolean;
}

export function readRun(space: string, path: string): Promise<RunRecord | undefined> {
  return readRecord<RunRecord>(runKey(space, path));
}

export async function writeRun(space: string, path: string, record: RunRecord): Promise<void> {
  await writeRecord(await caches.open(dataCache), runKey(space, path), record);
}
