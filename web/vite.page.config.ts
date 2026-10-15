import { createServer, defineConfig, type Plugin } from 'vite';

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

const variablesId = 'virtual:page-variables.css';

// pageVariables evaluates the app's theme with mantine's own resolver, which is
// what the app does in the browser; running it here gives the page the same
// custom properties without mantine and without a line of them copied
async function pageVariables(): Promise<string> {
  const server = await createServer({
    configFile: false,
    root: import.meta.dirname,
    logLevel: 'error',
    server: { middlewareMode: true, hmr: false, ws: false },
    appType: 'custom',
  });
  try {
    const module = await server.ssrLoadModule('/src/page/variables.ts');
    return (module as { pageVariables: () => string }).pageVariables();
  } finally {
    await server.close();
  }
}

function variables(): Plugin {
  return {
    name: 'scrawl-page-variables',
    resolveId(id) {
      return id === variablesId ? `\0${variablesId}` : undefined;
    },
    async load(id) {
      return id === `\0${variablesId}` ? pageVariables() : undefined;
    },
  };
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
    plugins: [variables(), woff2Only()],
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
