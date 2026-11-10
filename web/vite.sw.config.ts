import { defineConfig } from 'vite';

export default defineConfig({
  publicDir: false,
  build: {
    outDir: '../server/assets/sw',
    emptyOutDir: true,
    target: 'es2022',
    sourcemap: false,
    minify: true,
    rolldownOptions: {
      input: 'src/sw/sw.ts',
      output: { format: 'iife', entryFileNames: 'sw.js' },
    },
  },
});
