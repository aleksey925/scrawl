import type { IncomingMessage } from 'node:http';

import react from '@vitejs/plugin-react';
import { defineConfig, type ProxyOptions } from 'vite';

import { woff2Only } from './vite.fonts.ts';
import { themeStylesheet } from './vite.themes.ts';

const backend = 'http://127.0.0.1:7272';

// the routes that answer at the root whatever the space is. /api and /raw
// stay here for the global half of them - /api/login, /api/logout,
// /api/spaces - which is still served from the root.
const serverPaths = ['/api', '/raw', '/static', '/logout', '/ping', '/manifest.webmanifest'];

// everything a space owns, plus the login form. A browser navigation to an
// app route has to reach vite's index.html; everything else under them is the
// server's.
const sharedPaths = ['/s', '/login'];

// the routes inside a space the server always answers, whatever the Accept
// header says. /s/<name>/raw/img.png opened in a tab carries text/html like any
// navigation, so deciding on the header alone would hand it index.html and the
// raw handler would never be asked. /hook is here for the same reason, for
// anybody who ever points a provider at a dev instance.
const spaceServerRoute = /^\/s\/[^/]+\/(api|raw|hook)(\/|$)/;

function isNavigation(req: IncomingMessage): boolean {
  return req.method === 'GET' && (req.headers.accept ?? '').includes('text/html');
}

function bypass(req: IncomingMessage): string | undefined {
  const path = (req.url ?? '').split('?')[0] ?? '';
  if (spaceServerRoute.test(path)) {
    return undefined;
  }
  return isNavigation(req) ? '/index.html' : undefined;
}

// chunkFile names a chunk with no hash, a package's index after the package and
// never with a leading "_" or ".", which go:embed skips
function chunkFile(chunk: { name: string; facadeModuleId: string | null; moduleIds: string[] }): string {
  const first = chunk.facadeModuleId ?? chunk.moduleIds[0] ?? '';
  const pkg = /.*node_modules\/((?:@[^/]+\/)?[^/]+)\//.exec(first)?.[1];
  const name = (chunk.name === 'dist' || chunk.name === 'index') && pkg !== undefined ? pkg.replace(/^@/, '').replace('/', '-') : chunk.name;
  return `assets/${name.replace(/^[_.]+/, '')}.js`;
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
  plugins: [react(), themeStylesheet('themes.css'), woff2Only()],

  // relative, so every chunk is imported from the address the page started
  // with, where the server puts the bundle's digest
  base: command === 'build' ? './' : '/',

  build: {
    outDir: '../server/assets/app',
    assetsDir: 'assets',
    emptyOutDir: true,
    target: 'es2022',
    sourcemap: false,

    // not the default .vite/manifest.json: go:embed skips dot-prefixed entries,
    // so the server would embed the bundle and none of its index
    manifest: 'manifest.json',

    rolldownOptions: {
      output: {
        entryFileNames: 'assets/[name].js',
        chunkFileNames: chunkFile,
        assetFileNames: 'assets/[name][extname]',
      },
    },

    // an inlined font would arrive as a data: uri, which font-src refuses, and
    // nothing in the build output would say so
    assetsInlineLimit: 0,
  },

  worker: {
    rolldownOptions: {
      output: { entryFileNames: 'assets/[name].js', chunkFileNames: chunkFile },
    },
  },

  server: {
    port: 5173,
    strictPort: true,
    proxy: proxy(),
    // the themes are read from theme/themes, the go package that embeds them
    fs: { allow: ['..'] },
  },
}));
