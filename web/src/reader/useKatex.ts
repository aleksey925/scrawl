import { useEffect, type RefObject } from 'react';

import { preserveScroll } from './scroll';
import { fontsReady, mathSelector, typeset, type Katex } from './typeset';

export function useKatex(rootRef: RefObject<HTMLDivElement | null>, html: string): void {
  useEffect(() => {
    const root = rootRef.current;
    if (root === null) {
      return undefined;
    }
    const items = Array.from(root.querySelectorAll<HTMLElement>(mathSelector))
      .filter((node) => !node.classList.contains('is-typeset'))
      .map((node) => ({ node, tex: node.textContent ?? '' }));
    if (items.length === 0) {
      return undefined;
    }

    let cancelled = false;
    void (async () => {
      let katex: Katex;
      try {
        const [module] = await Promise.all([import('katex'), import('katex/dist/katex.min.css')]);
        katex = module.default;
      } catch {
        return;
      }
      if (cancelled) {
        return;
      }
      await fontsReady();
      if (cancelled) {
        return;
      }
      preserveScroll(root, () => {
        for (const item of items) {
          typeset(katex, item.node, item.tex);
        }
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [rootRef, html]);
}
