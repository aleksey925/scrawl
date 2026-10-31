import { createServer, type Plugin } from 'vite';

const virtualId = 'virtual:theme-stylesheet.css';

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
