import type { Plugin } from 'vite';

// woff2Only drops the two older formats katex lists after woff2. Every browser
// that runs these builds reads woff2, so the other two are never fetched.
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
