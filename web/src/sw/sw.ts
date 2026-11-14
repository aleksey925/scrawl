import type { SpaceEntry } from '../api/types';
import {
  answerUrl, appCachePrefix, canonicalPath, channelName, copyHeader, dataCache, decoded, fillAppMessage,
  networkDeadlineMs, serverUnreachable, signInCookies, spaceBase, type AppState, type ChannelMessage,
} from '../offline/keys';

import { rangeAnswer } from './range';

interface OfflineConfig {
  build: string;
  shell: string;
  assets: string[];
}

declare const self: ServiceWorkerGlobalScope & { scrawlOffline: OfflineConfig };

const config = self.scrawlOffline;

const appCache = appCachePrefix + config.build;

const spaceRoute = /^\/s\/([^/]+)\/(.*)$/;

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
        if ((await caches.match(config.shell, { cacheName: appCache })) === undefined) {
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
  const current = await caches.match(request, { cacheName: appCache, ignoreVary: true });
  if (current !== undefined) {
    return current;
  }
  const keys = (await caches.keys()).filter((name) => name.startsWith(appCachePrefix) && name !== appCache);
  for (const name of keys.reverse()) {
    const stored = await caches.match(request, { cacheName: name, ignoreVary: true });
    if (stored !== undefined) {
      return stored;
    }
  }
  return fetch(request);
}

function deadline(): Promise<undefined> {
  return new Promise((resolve) => setTimeout(() => resolve(undefined), networkDeadlineMs));
}

async function networkFirst(request: Request, stored: () => Promise<Response | undefined>): Promise<Response> {
  const kept = await stored();
  if (kept === undefined) {
    return fetch(request);
  }
  if (offline) {
    return rangeAnswer(request, kept);
  }
  try {
    const answer = await Promise.race([fetch(request), deadline()]);
    if (answer === undefined || serverUnreachable(answer)) {
      return rangeAnswer(request, kept);
    }
    return answer;
  } catch {
    return rangeAnswer(request, kept);
  }
}

async function signInPending(request: Request): Promise<boolean> {
  if (request.referrer !== '' && new URL(request.referrer).pathname === signInPath) {
    return true;
  }
  if (!('cookieStore' in self)) {
    return false;
  }
  for (const name of signInCookies) {
    const cookie = await self.cookieStore.get(name).catch(() => null);
    if (cookie?.value !== undefined) {
      return true;
    }
  }
  return false;
}

async function storedRaw(request: Request, pathname: string): Promise<Response | undefined> {
  if (await signInPending(request)) {
    return undefined;
  }
  return caches.match(canonicalPath(pathname), { cacheName: dataCache, ignoreVary: true });
}

async function storedAtOnce(request: Request, stored: Response | undefined): Promise<Response> {
  if (stored !== undefined && !(await signInPending(request))) {
    return stored;
  }
  return networkFirst(request, () => Promise.resolve(stored));
}

async function spaceShell(request: Request, space: string): Promise<Response> {
  const shell = await caches.match(config.shell);
  const me = await caches.match(answerUrl.me(spaceBase(decoded(space))), { cacheName: dataCache });
  if (me === undefined) {
    return networkFirst(request, () => Promise.resolve(shell));
  }
  return storedAtOnce(request, shell);
}

async function storedStartRedirect(): Promise<Response | undefined> {
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
  const [, space = '', rest] = spaceRoute.exec(url.pathname) ?? [];
  if (rest?.startsWith('raw/') === true) {
    event.respondWith(networkFirst(request, () => storedRaw(request, url.pathname)));
    return;
  }
  if (request.mode !== 'navigate') {
    return;
  }
  if (url.pathname === '/') {
    event.respondWith(storedStartRedirect().then((start) => storedAtOnce(request, start)));
    return;
  }
  if (rest !== undefined && !rest.startsWith('api/')) {
    event.respondWith(spaceShell(request, space));
  }
});
