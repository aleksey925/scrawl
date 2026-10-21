import type { MeResponse } from '../api/types';
import type { Platform } from '../platform';
import { findMatches } from '../reader/findMatches';
import type { MeState } from '../shell/useMe';

import type { SiteData } from './data';
import { fileOf } from './files';
import { siteLinks } from './links';
import { loadKatex, loadMermaid } from './loaders';
import type { PageStore } from './pages';
import { staticSource } from './staticSource';

// a site is the app's reader with no server behind it: the answers come with
// the pages, a link is a file of the site, and the renderers are files beside
// the script
export function sitePlatform(root: URL, store: PageStore, site: SiteData): Platform {
  return {
    source: staticSource(store, site),
    physicalUrl: (url) => new URL(fileOf(url), root).href,
    internalTarget: siteLinks(root, site.tree),
    loadMermaid,
    loadKatex,
    storageScope: root.pathname,
    search: false,
    editing: false,
    // a page opened from disk can start no worker, so the find runs here
    runFind: async (texts, pattern) => findMatches(texts, pattern),
    boundedFind: false,
  };
}
// siteStatus is what a site is as a space: one nobody signs in to, writes to,
// keeps the versions of or syncs
export function siteStatus(title: string): MeState {
  const me: MeResponse = {
    user: '',
    auth_on: false,
    read_only: true,
    history_on: false,
    history_degraded: false,
    site_title: title,
    version: '',
    space: {
      name: '',
      label: title,
      kind: 'local',
      read_only: true,
      format_on_save: false,
      degraded: false,
      unpublished: false,
      sync_error: '',
      unsynced: { paths: [], many: false },
      diverged: false,
      can_reset: false,
      push_refused: false,
    },
  };
  return { me, refreshMe: () => {} };
}
