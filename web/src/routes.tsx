import { createBrowserRouter, type RouteObject } from 'react-router';

import { RouteError } from './components/RouteError';
import { noteEntry } from './historyTrail';
import { mountBase } from './mount';
import { documentPage, editPage } from './pagePreloads';
import { loadChunk, reloadIfFailedQuietly } from './staleBundle';
import { AppLayout } from './shell/AppLayout';

function Blank(): null {
  return null;
}

function lazyPage<T>(load: () => Promise<T>): () => Promise<T> {
  return () =>
    loadChunk(
      load().then(async (module) => {
        if (await reloadIfFailedQuietly(load)) {
          throw new Error('Its part of the app did not load. Load the page again to open it.');
        }
        return module;
      }),
    );
}

const routes: RouteObject[] = [
  {
    path: '/',
    Component: AppLayout,
    ErrorBoundary: RouteError,
    HydrateFallback: Blank,
    children: [
      { index: true, lazy: lazyPage(() => import('./pages/HomePage')) },
      { path: 'doc/*', lazy: lazyPage(documentPage) },
      { path: 'edit/*', lazy: lazyPage(editPage) },
      { path: 'search', lazy: lazyPage(() => import('./pages/SearchPage')) },
      { path: 'recent', lazy: lazyPage(() => import('./pages/RecentPage')) },
      { path: 'history/*', lazy: lazyPage(() => import('./pages/HistoryPage')) },
      { path: '*', lazy: lazyPage(() => import('./pages/NotFoundPage')) },
    ],
  },
  {
    path: '/run/*',
    ErrorBoundary: RouteError,
    HydrateFallback: Blank,
    lazy: lazyPage(() => import('./pages/RunPage')),
  },
];

export const router = createBrowserRouter(routes, { basename: mountBase() });

noteEntry();
router.subscribe(() => noteEntry());
