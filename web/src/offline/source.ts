import { ApiError } from '../api/errors';
import type { DirListing, MeResponse, NavResponse, PageResponse, SpaceEntry } from '../api/types';
import { mountBase, mountRelease } from '../mount';
import { directoryUrl } from '../paths';
import type { Platform } from '../platform';
import { markBranch } from '../reader/tree';

import { answerUrl, dataCache } from './keys';
import { ownerChecked } from './owner';
import { meEntry, navEntry, readSpace, type StoredEntry } from './records';

export const notOnDevice = 'This is not on this device';

function spaceName(): string {
  return decodeURIComponent(mountBase().replace(/^\/s\//, ''));
}

function missing(): ApiError {
  return new ApiError(404, { error: notOnDevice });
}

async function storedEntry(key: string): Promise<StoredEntry | undefined> {
  await ownerChecked;
  const entry = (await readSpace(spaceName()))?.entries[key];
  return entry?.release === mountRelease() ? entry : undefined;
}

async function storedAnswer<T>(url: string): Promise<T> {
  const stored = await caches.match(url, { cacheName: dataCache });
  if (stored === undefined) {
    throw missing();
  }
  return (await stored.json()) as T;
}

export const offlineSource: Platform['source'] = {
  page: async (path) => {
    const entry = await storedEntry(path);
    if (entry?.kind === 'dir') {
      throw new ApiError(409, { error: 'path is a directory', kind: 'directory', url: directoryUrl(path) });
    }
    if (entry === undefined) {
      throw missing();
    }
    return storedAnswer<PageResponse>(answerUrl.page(mountBase(), path));
  },
  dir: async (path) => {
    const entry = await storedEntry(path);
    if (entry?.kind !== 'dir') {
      throw missing();
    }
    return storedAnswer<DirListing>(answerUrl.dir(mountBase(), path));
  },
  nav: async (path) => {
    if ((await storedEntry(navEntry)) === undefined) {
      throw missing();
    }
    const nav = await storedAnswer<NavResponse>(answerUrl.nav(mountBase()));
    return { tree: markBranch(nav.tree, path), breadcrumbs: [] };
  },
};

export async function storedMe(): Promise<MeResponse | undefined> {
  if ((await storedEntry(meEntry)) === undefined) {
    return undefined;
  }
  return storedAnswer<MeResponse>(answerUrl.me(mountBase())).catch(() => undefined);
}

export async function storedSpaces(): Promise<SpaceEntry[]> {
  await ownerChecked;
  return storedAnswer<SpaceEntry[]>(answerUrl.spaces).catch(() => []);
}

export function offlineMe(me: MeResponse): MeResponse {
  return {
    ...me,
    read_only: true,
    history_on: false,
    history_degraded: false,
    space: {
      ...me.space,
      read_only: true,
      degraded: false,
      unpublished: false,
      sync_error: '',
      unsynced: { paths: [], many: false },
      diverged: false,
      push_refused: false,
      retrying: false,
      pushing: false,
      can_reset: false,
    },
  };
}
