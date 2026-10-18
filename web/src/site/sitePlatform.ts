import type { MeResponse } from '../api/types';
import type { Platform } from '../platform';
import type { MeState } from '../shell/useMe';

import type { SiteData, SitePage } from './data';
import { fileOf } from './files';
import { loadKatex, loadMermaid } from './loaders';
import { staticSource } from './staticSource';

// a site is the app's reader with no server behind it: the answers came with
// the pages, a link to a note is a file the browser opens itself, and the
// renderers are files beside the script
export function sitePlatform(page: SitePage, site: SiteData): Platform {
  return {
    source: staticSource(page, site),
    physicalUrl: (url) => page.root + fileOf(url),
    internalTarget: () => undefined,
    loadMermaid,
    loadKatex,
    storageScope: new URL(page.root, window.location.href).pathname,
    search: false,
    editing: false,
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
