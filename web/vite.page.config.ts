import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

import { woff2Only } from './vite.fonts.ts';
import { themeStylesheet } from './vite.themes.ts';

// the stylesheets and scripts a page of `scrawl render` and `scrawl diff`
// carries inline, and the files every page of `scrawl site` links, written
// where the go package that embeds them lives. Fixed names and no hash:
// go:embed names them, and the page is one file anyway.
const outDir = '../page/assets';

// one build per entry: a script inlined into a page cannot load a chunk, and
// rolldown splits chunks whenever a build has more than one input
const entries = {
  page: 'src/page/page.ts',
  math: 'src/page/math.ts',
  // the app's reader, which every page of a site runs
  site: 'src/site/main.tsx',
  // what a page of a site runs before its body is read
  boot: 'src/site/boot.ts',
  // the diagram renderer a page of a site loads as a file of its own, only
  // when its note has a diagram; math is its formula renderer the same way
  diagrams: 'src/site/diagrams.ts',
} as const;

type Entry = keyof typeof entries;

function entryOf(name: string | undefined): Entry {
  return name !== undefined && name in entries ? (name as Entry) : 'page';
}

// what only the app can do, which a site must not carry: the editor, the
// requests to a server, the space's sync and account, and the two renderers a
// site loads as files of their own
const appOnly = [
  /\/src\/editor\//,
  /\/src\/api\/client\.ts$/,
  /\/src\/(App|appPlatform|findWorker|routes|main)\.tsx?$/,
  /\/src\/pages\/(EditPage|HistoryPage|SearchPage)\.tsx$/,
  /\/src\/shell\/(AppLayout|DocumentExtras|ExportMenu|FileActions|FileView|NoteMenu|ResetDialog|RowMenu|SearchDialog|SearchResults|SpaceAlerts|SpaceMenu|SyncControl|useMe|useMutationState)\.tsx?$/,
  /\/node_modules\/(@codemirror|@uiw|prettier|mermaid|katex)\//,
];

// siteFence fails the build of a site when it reaches what only the app does.
// The reader is shared and the app plugs its writes in, so an import that
// crosses the line is the reader growing a dependency on the server again.
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
      // the page is a file opened from disk, and a font beside it would be
      // missing the moment it is mailed or moved
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
