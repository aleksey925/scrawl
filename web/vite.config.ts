import type { IncomingMessage } from 'node:http';

import react from '@vitejs/plugin-react';
import { defineConfig, type ProxyOptions } from 'vite';

const backend = 'http://127.0.0.1:7272';

const serverPaths = ['/api', '/raw', '/static', '/logout', '/ping', '/manifest.webmanifest'];

// also app routes: a browser navigation has to reach vite's index.html, while
// everything else on them (the login post, a raw attachment) is the server's
const sharedPaths = ['/p', '/login'];

function isNavigation(req: IncomingMessage): boolean {
  return req.method === 'GET' && (req.headers.accept ?? '').includes('text/html');
}

function proxy(): Record<string, ProxyOptions> {
  const res: Record<string, ProxyOptions> = {};
  for (const path of serverPaths) {
    res[path] = { target: backend, changeOrigin: false };
  }
  for (const path of sharedPaths) {
    res[path] = {
      target: backend,
      changeOrigin: false,
      bypass: (req) => (isNavigation(req) ? '/index.html' : undefined),
    };
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
