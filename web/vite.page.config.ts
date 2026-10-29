import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

import { woff2Only } from './vite.fonts.ts';
import { themeStylesheet } from './vite.themes.ts';

const outDir = '../page/assets';

const entries = {
  page: 'src/page/page.ts',
  math: 'src/page/math.ts',
  site: 'src/site/main.tsx',
  boot: 'src/site/boot.ts',
  diagrams: 'src/site/diagrams.ts',
  plantuml: 'src/site/plantuml.ts',
} as const;

type Entry = keyof typeof entries;

function entryOf(name: string | undefined): Entry {
  return name !== undefined && name in entries ? (name as Entry) : 'page';
}

const appOnly = [
  /\/src\/editor\//,
  /\/src\/api\/client\.ts$/,
  /\/src\/(App|appPlatform|findWorker|routes|main)\.tsx?$/,
  /\/src\/pages\/(EditPage|HistoryPage|SearchPage)\.tsx$/,
  /\/src\/shell\/(AppLayout|DocumentExtras|EditButton|ExportMenu|FileActions|FileView|HistoryDialog|NewEntryDialog|NoteMenu|ResetDialog|RowMenu|SearchDialog|SearchResults|SpaceAlerts|SpaceMenu|SyncControl|TabBar|useMe|useMutationState)\.tsx?$/,
  /\/node_modules\/(@codemirror|@uiw|prettier|mermaid|katex|@plantuml|dompurify)\//,
];

function siteFence(): Plugin {
  return {
    name: 'scrawl-site-fence',
    load(id) {
      const crossed = appOnly.find((pattern) => pattern.test(id));
      if (crossed !== undefined) {
        this.error(`${id} belongs to the app and not to a site`);
      }
      return undefined;
    },
    generateBundle(_, bundle) {
      const chunks = Object.values(bundle).filter((file) => file.type === 'chunk');
      if (chunks.length !== 1) {
        this.error(`a page opened from disk loads one script, and the site build made ${chunks.length}`);
      }
    },
  };
}

export default defineConfig(() => {
  const entry = entryOf(process.env['SCRAWL_PAGE_ENTRY']);
  return {
    plugins: [react(), themeStylesheet(), woff2Only(), ...(entry === 'site' ? [siteFence()] : [])],
    publicDir: false,
    build: {
      outDir,
      emptyOutDir: false,
      target: 'es2022',
      sourcemap: false,
      cssCodeSplit: false,
      assetsInlineLimit: Number.POSITIVE_INFINITY,
      rolldownOptions: {
        input: entries[entry],
        output: {
          format: 'iife',
          entryFileNames: `${entry}.js`,
          assetFileNames: `${entry}[extname]`,
        },
      },
    },
  };
});
