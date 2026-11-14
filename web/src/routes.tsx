import { createBrowserRouter, type RouteObject } from 'react-router';

import { RouteError } from './components/RouteError';
import { Splash } from './components/Splash';
import { noteEntry } from './historyTrail';
import { mountBase } from './mount';
import { loadChunk } from './staleBundle';
import { AppLayout } from './shell/AppLayout';

function lazyPage<T>(load: () => Promise<T>): () => Promise<T> {
  return () => loadChunk(load());
}

const routes: RouteObject[] = [
  {
    path: '/',
    Component: AppLayout,
    ErrorBoundary: RouteError,
    HydrateFallback: Splash,
    children: [
      { index: true, lazy: lazyPage(() => import('./pages/HomePage')) },
      { path: 'doc/*', lazy: lazyPage(() => import('./pages/DocumentPage')) },
      { path: 'edit/*', lazy: lazyPage(() => import('./pages/EditPage')) },
      { path: 'search', lazy: lazyPage(() => import('./pages/SearchPage')) },
      { path: 'recent', lazy: lazyPage(() => import('./pages/RecentPage')) },
      { path: 'history/*', lazy: lazyPage(() => import('./pages/HistoryPage')) },
      { path: '*', lazy: lazyPage(() => import('./pages/NotFoundPage')) },
    ],
  },
  {
    path: '/run/*',
    ErrorBoundary: RouteError,
    HydrateFallback: Splash,
    lazy: lazyPage(() => import('./pages/RunPage')),
  },
];

export const router = createBrowserRouter(routes, { basename: mountBase() });

noteEntry();
router.subscribe(() => noteEntry());
