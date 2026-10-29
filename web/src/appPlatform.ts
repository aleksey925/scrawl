import { api } from './api/client';
import { mountBase } from './mount';
import type { Platform } from './platform';
import { FindTimeout, type FindMatch, type FindPattern } from './reader/findMatches';
import { internalTarget } from './reader/links';
import { loadChunk, reloadForStaleBundle } from './staleBundle';

const findDeadlineMs = 1000;

function runFind(texts: string[], pattern: FindPattern, signal: AbortSignal): Promise<FindMatch[]> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./findWorker.ts', import.meta.url), { type: 'module' });
    const stop = (): void => {
      window.clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      worker.terminate();
    };
    const abort = (): void => {
      stop();
      reject(new Error('the find was replaced'));
    };
    const timer = window.setTimeout(() => {
      stop();
      reject(new FindTimeout());
    }, findDeadlineMs);
    signal.addEventListener('abort', abort);
    worker.addEventListener('message', (event: MessageEvent<FindMatch[]>) => {
      stop();
      resolve(event.data);
    });
    worker.addEventListener('error', (event: Event) => {
      stop();
      if (!(event instanceof ErrorEvent) && reloadForStaleBundle()) {
        return;
      }
      reject(new Error(event instanceof ErrorEvent ? event.message : 'the find worker did not load'));
    });
    worker.postMessage({ texts, pattern });
  });
}

export const appPlatform: Platform = {
  source: api,
  physicalUrl: (url) => mountBase() + url,
  internalTarget,
  loadMermaid: async () => (await loadChunk(import('mermaid'))).default,
  loadPlantUML: async () => {
    const { plantUML } = await loadChunk(import('./reader/plantuml'));
    plantUML.setLibraryBase(new URL(/* @vite-ignore */ '../../plantuml/', import.meta.url).href);
    return plantUML;
  },
  loadKatex: async () => {
    const [module] = await loadChunk(Promise.all([import('katex'), import('katex/dist/katex.min.css')]));
    return module.default;
  },
  storageScope: mountBase(),
  search: true,
  editing: true,
  runFind,
  boundedFind: true,
};
