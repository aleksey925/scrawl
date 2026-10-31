import type { Plugin } from 'vite';

export function woff2Only(): Plugin {
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
