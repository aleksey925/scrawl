import type { IncomingMessage } from 'node:http';

import react from '@vitejs/plugin-react';
import { defineConfig, type ProxyOptions } from 'vite';

const backend = 'http://127.0.0.1:7272';

// the routes that answer at the root whatever the project is. /api and /raw
// stay here for the global half of them - /api/login, /api/logout,
// /api/projects - which is still served from the root.
const serverPaths = ['/api', '/raw', '/static', '/logout', '/ping', '/manifest.webmanifest'];

// everything a project owns, plus the login form. A browser navigation to an
// app route has to reach vite's index.html; everything else under them is the
// server's.
const sharedPaths = ['/p', '/login'];

// the routes inside a project the server always answers, whatever the Accept
// header says. /p/<name>/raw/img.png opened in a tab carries text/html like any
// navigation, so deciding on the header alone would hand it index.html and the
// raw handler would never be asked. /hook is here for the same reason, for
// anybody who ever points a provider at a dev instance.
const projectServerRoute = /^\/p\/[^/]+\/(api|raw|hook)(\/|$)/;

function isNavigation(req: IncomingMessage): boolean {
  return req.method === 'GET' && (req.headers.accept ?? '').includes('text/html');
}

function bypass(req: IncomingMessage): string | undefined {
  const path = (req.url ?? '').split('?')[0] ?? '';
  if (projectServerRoute.test(path)) {
    return undefined;
  }
  return isNavigation(req) ? '/index.html' : undefined;
}

function proxy(): Record<string, ProxyOptions> {
  const res: Record<string, ProxyOptions> = {};
  for (const path of serverPaths) {
    res[path] = { target: backend, changeOrigin: false };
  }
  for (const path of sharedPaths) {
    res[path] = { target: backend, changeOrigin: false, bypass };
  }
  return res;
}

export default defineConfig(({ command }) => ({
  plugins: [react()],

  // the go server ignores the version segment of /static/{version}/... on
  // lookup, so any literal resolves; the bundle is busted by content hash
  base: command === 'build' ? '/static/spa/app/' : '/',

  build: {
    outDir: '../server/assets/app',
    assetsDir: 'assets',
    emptyOutDir: true,
    target: 'es2022',
    sourcemap: false,

    // not the default .vite/manifest.json: go:embed skips dot-prefixed entries,
    // so the server would embed the bundle and none of its index
    manifest: 'manifest.json',

    // an inlined font would arrive as a data: uri, which font-src refuses, and
    // nothing in the build output would say so
    assetsInlineLimit: 0,
  },

  server: {
    port: 5173,
    strictPort: true,
    proxy: proxy(),
  },
}));
