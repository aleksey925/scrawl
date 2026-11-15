import { lazy } from 'react';

import { loadChunk } from '../staleBundle';

const loaders = {
  search: () => import('./SearchDialog'),
  move: () => import('./MoveDialog'),
  reset: () => import('./ResetDialog'),
};

export const SearchDialog = lazy(() => loadChunk(loaders.search()).then((module) => ({ default: module.SearchDialog })));

export const MoveDialog = lazy(() => loadChunk(loaders.move()).then((module) => ({ default: module.MoveDialog })));

export const ResetDialog = lazy(() => loadChunk(loaders.reset()).then((module) => ({ default: module.ResetDialog })));

const idleWaitMs = 300;

function whenIdle(task: () => void): void {
  const later = (): void => {
    if ('requestIdleCallback' in window) {
      window.requestIdleCallback(task);
    } else {
      setTimeout(task, idleWaitMs);
    }
  };
  if (document.readyState === 'complete') {
    later();
  } else {
    window.addEventListener('load', later, { once: true });
  }
}

export function preloadDialogs(): void {
  whenIdle(() => {
    for (const load of Object.values(loaders)) {
      void load().catch(() => undefined);
    }
  });
}
