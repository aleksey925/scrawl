import { createBrowserRouter, type RouteObject } from 'react-router';

import { RouteError } from './components/RouteError';
import { mountBase } from './mount';
import { loadChunk } from './staleBundle';
import { AppLayout } from './shell/AppLayout';

const routes: RouteObject[] = [
  {
    path: '/',
    Component: AppLayout,
    ErrorBoundary: RouteError,
    children: [
      { index: true, lazy: () => loadChunk(import('./pages/HomePage')) },
      { path: 'doc/*', lazy: () => loadChunk(import('./pages/DocumentPage')) },
      { path: 'edit/*', lazy: () => loadChunk(import('./pages/EditPage')) },
      { path: 'search', lazy: () => loadChunk(import('./pages/SearchPage')) },
      { path: 'recent', lazy: () => loadChunk(import('./pages/RecentPage')) },
      { path: 'history/*', lazy: () => loadChunk(import('./pages/HistoryPage')) },
      { path: '*', lazy: () => loadChunk(import('./pages/NotFoundPage')) },
    ],
  },
];

export const router = createBrowserRouter(routes, { basename: mountBase() });
