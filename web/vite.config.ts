import type { IncomingMessage } from 'node:http';

import react from '@vitejs/plugin-react';
import { defineConfig, type ProxyOptions } from 'vite';

import { plantUMLLibraryDir } from './src/plantumlLibrary.ts';
import { woff2Only } from './vite.fonts.ts';
import { themeStylesheet } from './vite.themes.ts';

const backend = 'http://127.0.0.1:7272';

const serverPaths = ['/api', '/raw', '/static', '/logout', '/ping', '/manifest.webmanifest'];

const sharedPaths = ['/s', '/login'];

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
  res[`/${plantUMLLibraryDir}`] = { target: backend, changeOrigin: false, rewrite: (path) => `/static/dev${path}` };
  return res;
}

export default defineConfig(({ command }) => ({
  plugins: [react(), themeStylesheet('themes.css'), woff2Only()],

  base: command === 'build' ? './' : '/',

  build: {
    outDir: '../server/assets/app',
    assetsDir: 'assets',
    emptyOutDir: true,
    target: 'es2022',
    sourcemap: false,

    manifest: 'manifest.json',

    rolldownOptions: {
      output: {
        entryFileNames: 'assets/[name].js',
        chunkFileNames: chunkFile,
        assetFileNames: 'assets/[name][extname]',
      },
    },

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
    fs: { allow: ['..'] },
  },
}));
