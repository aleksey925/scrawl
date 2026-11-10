import { backgroundHeader } from '../api/client';
import type { MeResponse, SpaceEntry } from '../api/types';

import { onMessage } from './channel';
import { connectionFailed, isOnline, onConnectionChange, onWrite } from './connection';
import { answerUrl, copyHeader, dataCache, spaceBase, spaceOfKey } from './keys';
import { tryCopyLock } from './lock';
import { ownerChecked, takeOwnership } from './owner';
import { offlineWanted } from './preference';
import {
  meEntry, navEntry, readSpace, readState, writeSpace, writeState,
  type CopyError, type SpaceRecord, type StoredEntry,
} from './records';
import { progressChanged, stateChanged } from './status';

export interface VersionEntry {
  path: string;
  kind: 'dir' | 'note' | 'file';
  version: string;
  size?: number;
}

export interface VersionList {
  release: string;
  entries: VersionEntry[];
}

export interface CopyTask {
  entry: VersionEntry;
  json: boolean;
  raw: boolean;
}

export interface CopyDiff {
  fetch: CopyTask[];
  drop: string[];
}

export function diffVersions(list: VersionList, stored: Readonly<Record<string, StoredEntry>>): CopyDiff {
  const listed = new Set<string>();
  const fetch: CopyTask[] = [];
  for (const entry of list.entries) {
    listed.add(entry.path);
    const kept = stored[entry.path];
    const changed = kept === undefined || kept.kind !== entry.kind || kept.version !== entry.version;
    const json = changed || kept.release !== list.release;
    if (json) {
      fetch.push({ entry, json, raw: entry.kind === 'file' && changed });
    }
  }
  const drop = Object.keys(stored).filter((path) => path !== navEntry && path !== meEntry && !listed.has(path));
  return { fetch, drop };
}

export function answerUrls(base: string, path: string, kind: StoredEntry['kind']): string[] {
  switch (kind) {
    case 'dir':
      return [answerUrl.dir(base, path)];
    case 'note':
      return [answerUrl.page(base, path)];
    case 'file':
      return [answerUrl.page(base, path), answerUrl.raw(base, path)];
    case 'nav':
      return [answerUrl.nav(base)];
    case 'me':
      return [answerUrl.me(base)];
  }
}

const parallel = 4;

const recordEvery = 20;

const minRoundGapMs = 20_000;

const afterWriteMs = 2_000;

class CopyStop extends Error {
  readonly reason: 'network' | 'unauthorized' | 'quota' | 'aborted';

  constructor(reason: CopyStop['reason']) {
    super(`the offline copy stopped: ${reason}`);
    this.reason = reason;
  }
}

function stopOf(error: unknown): CopyStop {
  if (error instanceof CopyStop) {
    return error;
  }
  if (error instanceof DOMException && error.name === 'QuotaExceededError') {
    return new CopyStop('quota');
  }
  if (error instanceof DOMException && error.name === 'AbortError') {
    return new CopyStop('aborted');
  }
  throw error;
}

async function get(url: string, signal: AbortSignal, headers: Record<string, string> = {}): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(url, {
      cache: 'no-store',
      credentials: 'same-origin',
      signal,
      headers: { accept: 'application/json', [backgroundHeader]: '1', [copyHeader]: '1', ...headers },
    });
  } catch (error) {
    if (error instanceof TypeError) {
      connectionFailed();
      throw new CopyStop('network');
    }
    throw error;
  }
  if (response.status === 401) {
    throw new CopyStop('unauthorized');
  }
  return response;
}

async function dropUrls(cache: Cache, urls: readonly string[]): Promise<void> {
  await Promise.all(urls.map((url) => cache.delete(url)));
}

async function dropSpace(cache: Cache, name: string): Promise<void> {
  const prefix = `${spaceBase(name)}/`;
  const keys = await cache.keys();
  await Promise.all(
    keys
      .filter((request) => {
        const { pathname } = new URL(request.url);
        return pathname.startsWith(prefix) || spaceOfKey(pathname) === name;
      })
      .map((request) => cache.delete(request)),
  );
}

async function storedSpaceNames(cache: Cache): Promise<string[]> {
  const names: string[] = [];
  for (const request of await cache.keys()) {
    const name = spaceOfKey(new URL(request.url).pathname);
    if (name !== undefined) {
      names.push(name);
    }
  }
  return names;
}

interface SpacePlan {
  name: string;
  base: string;
  record: SpaceRecord;
  list?: VersionList;
  etag: string;
  complete: boolean;
  dirty: boolean;
}

type Outcome = 'stored' | 'gone' | 'failed';

async function store(cache: Cache, urls: readonly string[], signal: AbortSignal): Promise<Outcome> {
  const answers: Response[] = [];
  for (const url of urls) {
    const response = await get(url, signal);
    if (response.status === 404) {
      return 'gone';
    }
    if (response.status !== 200) {
      return 'failed';
    }
    answers.push(response);
  }
  for (const [index, url] of urls.entries()) {
    const answer = answers[index];
    if (answer !== undefined) {
      await cache.put(url, answer);
    }
  }
  return 'stored';
}

async function planSpace(cache: Cache, entry: SpaceEntry, signal: AbortSignal): Promise<SpacePlan> {
  const base = spaceBase(entry.name);
  const record = (await readSpace(entry.name)) ?? { etag: '', entries: {} };
  const plan: SpacePlan = { name: entry.name, base, record, etag: record.etag, complete: true, dirty: false };
  const response = await get(answerUrl.versions(base), signal, record.etag === '' ? {} : { 'If-None-Match': record.etag });
  if (response.status === 304) {
    return plan;
  }
  if (response.status !== 200) {
    plan.complete = false;
    return plan;
  }
  plan.list = (await response.json()) as VersionList;
  plan.etag = response.headers.get('ETag') ?? '';
  plan.etag = plan.etag === '' ? record.etag : plan.etag;
  const { drop } = diffVersions(plan.list, record.entries);
  for (const path of drop) {
    const kept = record.entries[path];
    if (kept !== undefined) {
      await dropUrls(cache, answerUrls(base, path, kept.kind));
      delete record.entries[path];
      plan.dirty = true;
    }
  }
  return plan;
}

async function copyEntries(cache: Cache, plans: SpacePlan[], signal: AbortSignal): Promise<void> {
  const work = plans.flatMap((plan) =>
    plan.list === undefined ? [] : diffVersions(plan.list, plan.record.entries).fetch.map((task) => ({ plan, task })),
  );
  let done = 0;
  let unrecorded = 0;
  const report = (): void => progressChanged({ done, total: work.length });
  report();
  let next = 0;

  const flush = async (): Promise<void> => {
    unrecorded = 0;
    for (const plan of plans) {
      if (plan.dirty) {
        plan.dirty = false;
        await writeSpace(cache, plan.name, plan.record);
      }
    }
  };

  const worker = async (): Promise<void> => {
    while (next < work.length) {
      const item = work[next];
      next += 1;
      if (item === undefined) {
        continue;
      }
      const { plan, task } = item;
      const urls: string[] = [];
      if (task.json) {
        urls.push(task.entry.kind === 'dir' ? answerUrl.dir(plan.base, task.entry.path) : answerUrl.page(plan.base, task.entry.path));
      }
      if (task.raw) {
        urls.push(answerUrl.raw(plan.base, task.entry.path));
      }
      const outcome = await store(cache, urls, signal);
      if (outcome === 'stored') {
        plan.record.entries[task.entry.path] = { kind: task.entry.kind, version: task.entry.version, release: plan.list?.release ?? '' };
      } else if (outcome === 'gone') {
        await dropUrls(cache, answerUrls(plan.base, task.entry.path, task.entry.kind));
        delete plan.record.entries[task.entry.path];
      } else {
        plan.complete = false;
      }
      plan.dirty = true;
      done += 1;
      unrecorded += 1;
      report();
      if (unrecorded >= recordEvery) {
        await flush();
      }
    }
  };

  try {
    await Promise.all(Array.from({ length: parallel }, worker));
  } finally {
    await flush();
  }
}

async function copySpaceAnswers(cache: Cache, plan: SpacePlan, signal: AbortSignal): Promise<void> {
  const release = plan.list?.release ?? '';
  for (const [key, kind] of [[navEntry, 'nav'], [meEntry, 'me']] as const) {
    const outcome = await store(cache, answerUrls(plan.base, '', kind), signal);
    if (outcome === 'stored') {
      plan.record.entries[key] = { kind, version: '', release };
    } else {
      plan.complete = false;
    }
  }
}

async function round(user: string, signal: AbortSignal): Promise<CopyError> {
  await takeOwnership(user);
  const cache = await caches.open(dataCache);

  const spacesAnswer = await get(answerUrl.spaces, signal);
  if (spacesAnswer.status !== 200) {
    return 'failed';
  }
  const spaces = (await spacesAnswer.clone().json()) as SpaceEntry[];
  await cache.put(answerUrl.spaces, spacesAnswer);

  const names = new Set(spaces.map((entry) => entry.name));
  for (const name of await storedSpaceNames(cache)) {
    if (!names.has(name)) {
      await dropSpace(cache, name);
    }
  }

  const plans: SpacePlan[] = [];
  for (const entry of spaces) {
    plans.push(await planSpace(cache, entry, signal));
  }
  await copyEntries(cache, plans, signal);

  for (const plan of plans) {
    if (plan.list !== undefined) {
      await copySpaceAnswers(cache, plan, signal);
      if (plan.complete) {
        plan.record.etag = plan.etag;
      }
      await writeSpace(cache, plan.name, plan.record);
    }
  }
  return plans.every((plan) => plan.complete) ? '' : 'failed';
}

let user: string | undefined;

let quotaHit = false;

let lastRound = 0;

let persisted = false;

let running: AbortController | undefined;

let soon: number | undefined;

async function finishRound(error: CopyError): Promise<void> {
  const state = await readState();
  if (state === undefined) {
    return;
  }
  const cache = await caches.open(dataCache);
  await writeState(cache, { ...state, error, updatedAt: error === '' ? Date.now() : state.updatedAt });
}

async function runRound(owner: string): Promise<void> {
  const controller = new AbortController();
  running = controller;
  try {
    const error = await round(owner, controller.signal);
    await finishRound(error);
  } catch (error) {
    const stop = stopOf(error);
    if (stop.reason === 'unauthorized') {
      user = undefined;
    } else if (stop.reason === 'quota') {
      quotaHit = true;
      await finishRound('quota');
    }
  } finally {
    running = undefined;
    progressChanged(undefined);
    stateChanged();
  }
}

function startRound(force: boolean): void {
  const owner = user;
  if (!offlineWanted() || !isOnline() || owner === undefined || quotaHit || running !== undefined) {
    return;
  }
  if (!force && Date.now() - lastRound < minRoundGapMs) {
    return;
  }
  lastRound = Date.now();
  if (!persisted) {
    persisted = true;
    void navigator.storage.persist?.();
  }
  void ownerChecked.then(() => tryCopyLock(() => runRound(owner)));
}

export function meAnswered(me: MeResponse): void {
  user = me.user;
  startRound(false);
}

export function copyNow(): void {
  startRound(true);
}

export function stopCopy(): void {
  running?.abort();
}

export function startCopy(): void {
  onMessage((message) => {
    if (message.type === 'abort') {
      stopCopy();
    } else if (message.type === 'owner') {
      user = undefined;
      stopCopy();
    }
  });
  onWrite(() => {
    window.clearTimeout(soon);
    soon = window.setTimeout(() => startRound(true), afterWriteMs);
  });
  onConnectionChange(() => {
    if (!isOnline()) {
      stopCopy();
    }
  });
}
