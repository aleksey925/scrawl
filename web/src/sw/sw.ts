import type { SpaceEntry } from '../api/types';
import {
  answerUrl, appCachePrefix, canonicalPath, channelName, copyHeader, dataCache, fillAppMessage,
  type AppState, type ChannelMessage,
} from '../offline/keys';

interface OfflineConfig {
  build: string;
  shell: string;
  assets: string[];
}

declare const self: ServiceWorkerGlobalScope & { scrawlOffline: OfflineConfig };

const config = self.scrawlOffline;

const appCache = appCachePrefix + config.build;

const deadlineMs = 3_000;

const unavailable = new Set([502, 503, 504]);

const spaceRoute = /^\/s\/[^/]+\/(.*)$/;

const signInPath = '/login';

const channel = new BroadcastChannel(channelName);

let offline = false;

channel.addEventListener('message', (event: MessageEvent<ChannelMessage>) => {
  if (event.data.type === 'connection') {
    offline = !event.data.online;
  }
});

function tell(state: AppState): void {
  const message: ChannelMessage = { type: 'app', state };
  channel.postMessage(message);
}

function quotaError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'QuotaExceededError';
}

async function fillAppCache(): Promise<void> {
  tell('downloading');
  const cache = await caches.open(appCache);
  try {
    await cache.addAll(config.assets);
  } catch (error) {
    await caches.delete(appCache);
    tell(quotaError(error) ? 'quota' : 'failed');
    throw error;
  }
  tell('ready');
}

self.addEventListener('install', (event) => {
  event.waitUntil(fillAppCache().then(() => self.skipWaiting()));
});

self.addEventListener('message', (event) => {
  if (event.data === fillAppMessage) {
    event.waitUntil(
      (async () => {
        if (!(await caches.has(appCache))) {
          await fillAppCache();
        }
      })(),
    );
  }
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const others = (await caches.keys()).filter((name) => name.startsWith(appCachePrefix) && name !== appCache);
      const previous = others.at(-1);
      await Promise.all(others.filter((name) => name !== previous).map((name) => caches.delete(name)));
      await self.clients.claim();
    })(),
  );
});

async function fromAppCache(request: Request): Promise<Response> {
  const keys = (await caches.keys()).filter((name) => name.startsWith(appCachePrefix));
  for (const name of [appCache, ...keys.filter((entry) => entry !== appCache).reverse()]) {
    const stored = await caches.match(request, { cacheName: name, ignoreVary: true });
    if (stored !== undefined) {
      return stored;
    }
  }
  return fetch(request);
}

function deadline(): Promise<undefined> {
  return new Promise((resolve) => setTimeout(() => resolve(undefined), deadlineMs));
}

async function networkFirst(request: Request, stored: () => Promise<Response | undefined>): Promise<Response> {
  const kept = await stored();
  if (kept === undefined) {
    return fetch(request);
  }
  if (offline) {
    return kept;
  }
  try {
    const answer = await Promise.race([fetch(request), deadline()]);
    if (answer === undefined || unavailable.has(answer.status)) {
      return kept;
    }
    return answer;
  } catch {
    return kept;
  }
}

function rangeOf(header: string, size: number): { start: number; end: number } | undefined {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (match === null) {
    return undefined;
  }
  const [, from = '', to = ''] = match;
  if (from === '' && to === '') {
    return undefined;
  }
  if (from === '') {
    return { start: Math.max(size - Number(to), 0), end: size - 1 };
  }
  return { start: Number(from), end: to === '' ? size - 1 : Math.min(Number(to), size - 1) };
}

async function rangeAnswer(request: Request, stored: Response): Promise<Response> {
  const header = request.headers.get('range');
  if (header === null) {
    return stored;
  }
  const body = await stored.blob();
  const range = rangeOf(header, body.size);
  if (range === undefined) {
    return new Response(body, { status: stored.status, headers: stored.headers });
  }
  if (range.start >= body.size || range.start > range.end) {
    return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${body.size}` } });
  }
  const headers = new Headers(stored.headers);
  headers.set('Content-Range', `bytes ${range.start}-${range.end}/${body.size}`);
  headers.set('Content-Length', String(range.end - range.start + 1));
  return new Response(body.slice(range.start, range.end + 1), { status: 206, headers });
}

async function storedRaw(request: Request, pathname: string): Promise<Response | undefined> {
  const stored = await caches.match(canonicalPath(pathname), { cacheName: dataCache, ignoreVary: true });
  return stored === undefined ? undefined : rangeAnswer(request, stored);
}

function fromSignIn(request: Request): boolean {
  return request.referrer !== '' && new URL(request.referrer).pathname === signInPath;
}

async function startPage(): Promise<Response | undefined> {
  const stored = await caches.match(answerUrl.spaces, { cacheName: dataCache });
  if (stored === undefined) {
    return undefined;
  }
  const spaces = (await stored.json()) as SpaceEntry[];
  const first = spaces[0];
  return first === undefined ? undefined : Response.redirect(first.url, 302);
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || request.headers.has(copyHeader)) {
    return;
  }
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) {
    return;
  }
  if (url.pathname.startsWith('/static/')) {
    event.respondWith(fromAppCache(request));
    return;
  }
  const rest = spaceRoute.exec(url.pathname)?.[1];
  if (rest?.startsWith('raw/') === true) {
    if (request.mode === 'navigate' && fromSignIn(request)) {
      return;
    }
    event.respondWith(networkFirst(request, () => storedRaw(request, url.pathname)));
    return;
  }
  if (request.mode !== 'navigate') {
    return;
  }
  if (url.pathname === '/') {
    event.respondWith(networkFirst(request, startPage));
    return;
  }
  if (rest !== undefined && !rest.startsWith('api/')) {
    event.respondWith(networkFirst(request, () => caches.match(config.shell)));
  }
});
