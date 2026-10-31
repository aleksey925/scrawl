import type { MeResponse } from '../api/types';
import type { Platform } from '../platform';
import { findMatches } from '../reader/findMatches';
import type { MeState } from '../shell/useMe';

import type { SiteData } from './data';
import { fileOf } from './files';
import { siteLinks } from './links';
import { loadKatex, loadMermaid, loadPlantUML } from './loaders';
import type { PageStore } from './pages';
import { staticSource } from './staticSource';

export function sitePlatform(root: URL, store: PageStore, site: SiteData): Platform {
  return {
    source: staticSource(store, site),
    physicalUrl: (url) => new URL(fileOf(url), root).href,
    internalTarget: siteLinks(root, site.tree),
    loadMermaid,
    loadPlantUML,
    loadKatex,
    storageScope: root.pathname,
    search: false,
    editing: false,
    runFind: async (texts, pattern) => findMatches(texts, pattern),
    boundedFind: false,
  };
}
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
