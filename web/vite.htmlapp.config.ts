import { defineConfig, type UserConfig } from 'vite';

const entries = {
  enter: 'src/htmlapp/enter.ts',
  sw: 'src/htmlapp/worker.ts',
} as const;

type Entry = keyof typeof entries;

function entryOf(name: string | undefined): Entry {
  return name !== undefined && name in entries ? (name as Entry) : 'enter';
}

export default defineConfig((): UserConfig => {
  const entry = entryOf(process.env['SCRAWL_HTMLAPP_ENTRY']);
  return {
    publicDir: false,
    build: {
      outDir: '../server/assets/htmlapp',
      emptyOutDir: false,
      target: 'es2022',
      sourcemap: false,
      minify: true,
      rolldownOptions: {
        input: entries[entry],
        output: { format: 'iife', entryFileNames: `${entry}.js` },
      },
    },
  };
});
