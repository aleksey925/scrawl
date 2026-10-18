import { api } from './api/client';
import { mountBase } from './mount';
import type { Platform } from './platform';
import { internalTarget } from './reader/links';

// the app is served by the go server: answers are fetched, every url carries
// the space's prefix, and the heavy renderers are chunks of the bundle
export const appPlatform: Platform = {
  source: api,
  physicalUrl: (url) => mountBase() + url,
  internalTarget,
  loadMermaid: async () => (await import('mermaid')).default,
  loadKatex: async () => {
    const [module] = await Promise.all([import('katex'), import('katex/dist/katex.min.css')]);
    return module.default;
  },
  storageScope: mountBase(),
  search: true,
  editing: true,
};
