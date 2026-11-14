import { encodeContentPath } from '../contentPath';
import { canonicalPath, fromScrawl, networkDeadlineMs, serverUnreachable } from '../offline/keys';
import { rangeAnswer } from '../sw/range';

import { htmlappCache, type WorkerMessage } from './protocol';

declare const self: ServiceWorkerGlobalScope;

const ownPrefix = '/__scrawl/';

const keptKey = '/__scrawl/kept';

const listUrl = '/__scrawl/files';

const fetchesAtOnce = 4;

const missingText = 'This file is not on this device. Open the app once with a network.';

const parentShape = /^https?:\/\/[a-z0-9.:[\]-]+$/i;

interface Kept {
  etag: string;
  parent: string;
}

interface ListedFile {
  path: string;
  etag: string;
}

interface FileList {
  files: ListedFile[];
}

let changes: Promise<unknown> = Promise.resolve();

let refreshes: Promise<unknown> = Promise.resolve();

const pending = new Set<AbortController>();

function change<T>(task: () => Promise<T>): Promise<T> {
  const next = changes.then(task);
  changes = next.catch(() => undefined);
  return next;
}

async function existing(): Promise<Cache | undefined> {
  return (await caches.has(htmlappCache)) ? caches.open(htmlappCache) : undefined;
}

function keyOf(pathname: string): string {
  const path = canonicalPath(pathname);
  return path.endsWith('/') ? `${path}index.html` : path;
}

function listedKey(entry: ListedFile): string {
  return keyOf(`/${encodeContentPath(entry.path)}`);
}

async function readKept(cache: Cache): Promise<Kept | undefined> {
  const stored = await cache.match(keptKey);
  return stored === undefined ? undefined : ((await stored.json()) as Kept);
}

async function writeKept(cache: Cache, kept: Kept): Promise<void> {
  await cache.put(keptKey, new Response(JSON.stringify(kept), { headers: { 'Content-Type': 'application/json' } }));
}

async function forgetListVersion(cache: Cache): Promise<void> {
  const kept = await readKept(cache);
  if (kept !== undefined && kept.etag !== '') {
    await writeKept(cache, { ...kept, etag: '' });
  }
}

function storeFile(key: string, response: Response, signal?: AbortSignal): Promise<boolean> {
  return change(async () => {
    const cache = await existing();
    if (cache === undefined || signal?.aborted === true) {
      return false;
    }
    const etag = response.headers.get('ETag');
    const stored = await cache.match(key, { ignoreVary: true });
    if (etag !== null && stored?.headers.get('ETag') === etag) {
      return true;
    }
    await forgetListVersion(cache);
    await cache.put(key, response);
    return true;
  });
}

function dropFile(key: string): Promise<void> {
  return change(async () => {
    const cache = await existing();
    if (cache === undefined || (await cache.match(key, { ignoreVary: true })) === undefined) {
      return;
    }
    await forgetListVersion(cache);
    await cache.delete(key, { ignoreVary: true });
  });
}

function purge(): Promise<boolean> {
  for (const controller of pending) {
    controller.abort();
  }
  pending.clear();
  return change(() => caches.delete(htmlappCache));
}

type Settled = 'stored' | 'purged' | 'other';

async function settle(key: string, request: Request | undefined, response: Response, signal?: AbortSignal): Promise<Settled> {
  if (response.status === 401 && fromScrawl(response)) {
    await purge();
    return 'purged';
  }
  if (response.status === 404 && fromScrawl(response)) {
    await dropFile(key);
    return 'other';
  }
  const ranged = request?.headers.has('range') === true;
  if (response.status !== 200 || ranged || response.redirected || response.type !== 'basic') {
    return 'other';
  }
  return (await storeFile(key, response, signal)) ? 'stored' : 'other';
}

async function eachAtOnce<T>(entries: readonly T[], signal: AbortSignal, task: (entry: T) => Promise<void>): Promise<void> {
  let next = 0;
  const lane = async (): Promise<void> => {
    while (!signal.aborted) {
      const entry = entries[next];
      if (entry === undefined) {
        return;
      }
      next += 1;
      await task(entry);
    }
  };
  await Promise.all(Array.from({ length: Math.min(fetchesAtOnce, entries.length) }, lane));
}

async function fetchList(etag: string, signal: AbortSignal): Promise<{ list: FileList; etag: string } | undefined> {
  const headers: Record<string, string> = etag === '' ? {} : { 'If-None-Match': etag };
  const response = await fetch(listUrl, { headers, signal, cache: 'no-store' });
  if (response.status === 401 && fromScrawl(response)) {
    await purge();
    return undefined;
  }
  if (response.status !== 200) {
    return undefined;
  }
  return { list: (await response.json()) as FileList, etag: response.headers.get('ETag') ?? '' };
}

async function filesToFetch(cache: Cache, wanted: Map<string, ListedFile>): Promise<string[]> {
  const res: string[] = [];
  for (const [key, entry] of wanted) {
    const stored = await cache.match(key, { ignoreVary: true });
    if (stored?.headers.get('ETag') !== entry.etag) {
      res.push(key);
    }
  }
  return res;
}

async function dropGone(cache: Cache, wanted: Map<string, ListedFile>): Promise<void> {
  for (const request of await cache.keys()) {
    const { pathname } = new URL(request.url);
    if (pathname !== keptKey && !wanted.has(pathname)) {
      await dropFile(pathname);
    }
  }
}

async function refreshFolder(controller: AbortController): Promise<void> {
  const { signal } = controller;
  const cache = await existing();
  const kept = cache === undefined ? undefined : await readKept(cache);
  if (cache === undefined || kept === undefined || signal.aborted) {
    return;
  }
  const fetched = await fetchList(kept.etag, signal);
  if (fetched === undefined || signal.aborted) {
    return;
  }
  const wanted = new Map(fetched.list.files.map((entry) => [listedKey(entry), entry]));
  await dropGone(cache, wanted);
  let complete = true;
  try {
    await eachAtOnce(await filesToFetch(cache, wanted), signal, async (key) => {
      const response = await fetch(key, { signal, cache: 'no-cache' }).catch(() => undefined);
      if (response === undefined) {
        complete = false;
        return;
      }
      const outcome = await settle(key, undefined, response, signal);
      if (outcome === 'purged') {
        controller.abort();
      }
      if (outcome !== 'stored') {
        complete = false;
      }
    });
  } catch (error) {
    controller.abort();
    throw error;
  }
  if (!complete || signal.aborted) {
    return;
  }
  await change(async () => {
    const current = await existing();
    const record = current === undefined ? undefined : await readKept(current);
    if (current !== undefined && record !== undefined && !signal.aborted) {
      await writeKept(current, { ...record, etag: fetched.etag });
    }
  });
}

async function startRefresh(parent: string, ready: () => void): Promise<void> {
  const controller = new AbortController();
  pending.add(controller);
  try {
    await change(async () => {
      if (controller.signal.aborted) {
        return;
      }
      const cache = await caches.open(htmlappCache);
      const kept = await readKept(cache);
      await writeKept(cache, { etag: kept?.etag ?? '', parent });
    });
  } finally {
    ready();
  }
  const next = refreshes.then(() => refreshFolder(controller));
  refreshes = next.catch(() => undefined);
  await next.catch(() => undefined).finally(() => pending.delete(controller));
}

function deadline(): Promise<undefined> {
  return new Promise((resolve) => setTimeout(() => resolve(undefined), networkDeadlineMs));
}

async function fromCache(request: Request, stored: Response): Promise<Response> {
  const cache = await existing();
  const kept = cache === undefined ? undefined : await readKept(cache);
  const headers = new Headers(stored.headers);
  if (kept !== undefined) {
    headers.set('Content-Security-Policy', `frame-ancestors ${kept.parent}`);
  }
  const answer = new Response(stored.body, { status: stored.status, statusText: stored.statusText, headers });
  return rangeAnswer(request, answer);
}

function missing(): Response {
  return new Response(missingText, { status: 504, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}

async function answer(event: FetchEvent, url: URL): Promise<Response> {
  const { request } = event;
  const key = keyOf(url.pathname);
  const network = fetch(request);
  event.waitUntil(network.then((response) => settle(key, request, response.clone()), () => undefined));
  const stored = await caches.match(key, { cacheName: htmlappCache, ignoreVary: true });
  if (stored === undefined) {
    return network.catch(missing);
  }
  const first = await Promise.race([network.catch(() => undefined), deadline()]);
  if (first === undefined || serverUnreachable(first)) {
    return fromCache(request, stored);
  }
  return first;
}

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('message', (event) => {
  const message = event.data as WorkerMessage | null;
  const reply = (): void => event.ports[0]?.postMessage('done');
  if (message?.type === 'refresh' && typeof message.parent === 'string' && parentShape.test(message.parent)) {
    event.waitUntil(startRefresh(message.parent, reply));
  } else if (message?.type === 'off') {
    event.waitUntil(purge().finally(reply));
  }
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith(ownPrefix)) {
    return;
  }
  event.respondWith(answer(event, url));
});
