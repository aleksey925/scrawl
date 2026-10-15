import { defineConfig, type Plugin } from 'vite';

import { themeStylesheet } from './vite.themes.ts';

// the stylesheets and scripts a page of `scrawl render` and `scrawl diff`
// carries inline, written where the go package that embeds them lives. Fixed
// names and no hash: go:embed names them, and the page is one file anyway.
const outDir = '../page/assets';

// one build per entry: a script inlined into a page cannot load a chunk, and
// rolldown splits chunks whenever a build has more than one input
const entries = {
  page: 'src/page/page.ts',
  math: 'src/page/math.ts',
} as const;

type Entry = keyof typeof entries;

function entryOf(name: string | undefined): Entry {
  return name === 'math' ? 'math' : 'page';
}

// every browser the page can be opened in reads woff2, and the two older
// formats katex lists after it would triple what is inlined
function woff2Only(): Plugin {
  return {
    name: 'scrawl-katex-woff2',
    enforce: 'pre',
    transform(code, id) {
      if (!/katex(\.min)?\.css$/.test(id)) {
        return undefined;
      }
      return code.replace(/,\s*url\([^)]*\.(?:woff|ttf)\)\s*format\("(?:woff|truetype)"\)/g, '');
    },
  };
}

export default defineConfig(() => {
  const entry = entryOf(process.env['SCRAWL_PAGE_ENTRY']);
  return {
    plugins: [themeStylesheet(), woff2Only()],
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
