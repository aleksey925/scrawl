import { api } from './api/client';
import { mountBase } from './mount';
import type { Platform } from './platform';
import { FindTimeout, type FindMatch, type FindPattern } from './reader/findMatches';
import { internalTarget } from './reader/links';

// findDeadlineMs is how long a find of a note may run before its worker is
// stopped: a regular expression can run for minutes and freeze the tab
const findDeadlineMs = 1000;

function runFind(texts: string[], pattern: FindPattern): Promise<FindMatch[]> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./findWorker.ts', import.meta.url), { type: 'module' });
    const timer = window.setTimeout(() => {
      worker.terminate();
      reject(new FindTimeout());
    }, findDeadlineMs);
    worker.addEventListener('message', (event: MessageEvent<FindMatch[]>) => {
      window.clearTimeout(timer);
      worker.terminate();
      resolve(event.data);
    });
    worker.addEventListener('error', (event) => {
      window.clearTimeout(timer);
      worker.terminate();
      reject(new Error(event.message));
    });
    worker.postMessage({ texts, pattern });
  });
}

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
  filePages: true,
  runFind,
  boundedFind: true,
};
