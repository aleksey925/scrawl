import { encodeContentPath } from '../contentPath';

export const appCachePrefix = 'scrawl-app-';

export const dataCache = 'scrawl-data';

export const copyHeader = 'X-Scrawl-Offline-Copy';

export const channelName = 'scrawl-offline';

export const stateKey = '/__scrawl-offline/state';

const spaceKeyPrefix = '/__scrawl-offline/space/';

export function spaceKey(name: string): string {
  return spaceKeyPrefix + encodeURIComponent(name);
}

export function spaceOfKey(pathname: string): string | undefined {
  return pathname.startsWith(spaceKeyPrefix) ? decodeURIComponent(pathname.slice(spaceKeyPrefix.length)) : undefined;
}

export function spaceBase(name: string): string {
  return `/s/${encodeURIComponent(name)}`;
}

export const answerUrl = {
  page: (base: string, path: string): string => `${base}/api/page/${encodeContentPath(path)}`,
  dir: (base: string, path: string): string => `${base}/api/dir/${encodeContentPath(path)}`,
  raw: (base: string, path: string): string => `${base}/raw/${encodeContentPath(path)}`,
  nav: (base: string): string => `${base}/api/nav?path=`,
  me: (base: string): string => `${base}/api/me`,
  versions: (base: string): string => `${base}/api/versions`,
  spaces: '/api/spaces',
};

function decoded(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

export function canonicalPath(pathname: string): string {
  return encodeContentPath(pathname.split('/').map(decoded).join('/'));
}

export type AppState = 'downloading' | 'ready' | 'quota' | 'failed';

export type ChannelMessage =
  | { type: 'connection'; online: boolean }
  | { type: 'app'; state: AppState }
  | { type: 'progress'; done: number; total: number }
  | { type: 'ask' }
  | { type: 'state' }
  | { type: 'choice' }
  | { type: 'abort' }
  | { type: 'owner' };
