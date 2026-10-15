import { createServer, type Plugin } from 'vite';

const virtualId = 'virtual:theme-stylesheet.css';

// render evaluates the theme with mantine's own resolver, which is what the app
// used to do in the browser; doing it here gives the app, the sign-in page and
// a page of the command line the same custom properties from one place
async function render(): Promise<string> {
  const server = await createServer({
    configFile: false,
    root: import.meta.dirname,
    logLevel: 'error',
    server: { middlewareMode: true, hmr: false, ws: false },
    appType: 'custom',
  });
  try {
    const module = await server.ssrLoadModule('/src/themeStylesheet.ts');
    return (module as { themeStylesheet: () => string }).themeStylesheet();
  } finally {
    await server.close();
  }
}

// themeStylesheet answers `import 'virtual:theme-stylesheet.css'`. With emit it
// also writes the sheet beside the bundle under that fixed name, for the
// sign-in page, which loads no bundle.
export function themeStylesheet(emit?: string): Plugin {
  let css: Promise<string> | undefined;
  const source = (): Promise<string> => (css ??= render());
  return {
    name: 'scrawl-theme-stylesheet',
    resolveId(id) {
      return id === virtualId ? `\0${virtualId}` : undefined;
    },
    async load(id) {
      return id === `\0${virtualId}` ? source() : undefined;
    },
    async generateBundle() {
      if (emit !== undefined) {
        this.emitFile({ type: 'asset', fileName: emit, source: await source() });
      }
    },
  };
}
