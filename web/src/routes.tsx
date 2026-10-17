import { createBrowserRouter, type RouteObject } from 'react-router';

import { RouteError } from './components/RouteError';
import { mountBase } from './mount';
import { AppLayout } from './shell/AppLayout';

const routes: RouteObject[] = [
  {
    path: '/',
    Component: AppLayout,
    ErrorBoundary: RouteError,
    children: [
      { index: true, lazy: () => import('./pages/HomePage') },
      { path: 'doc/*', lazy: () => import('./pages/DocumentPage') },
      { path: 'edit/*', lazy: () => import('./pages/EditPage') },
      { path: 'search', lazy: () => import('./pages/SearchPage') },
      { path: 'history/*', lazy: () => import('./pages/HistoryPage') },
      { path: '*', lazy: () => import('./pages/NotFoundPage') },
    ],
  },
];

export const router = createBrowserRouter(routes, { basename: mountBase() });
