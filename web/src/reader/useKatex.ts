import { useEffect, type RefObject } from 'react';

import { usePlatform } from '../platform';

import { track } from './pending';
import { preserveScroll } from './scroll';
import { fontsReady, mathSelector, typeset, type Katex } from './typeset';

export function useKatex(rootRef: RefObject<HTMLDivElement | null>, html: string): void {
  const { loadKatex } = usePlatform();

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
    track((async () => {
      let katex: Katex;
      try {
        katex = await loadKatex();
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
    })());

    return () => {
      cancelled = true;
    };
  }, [rootRef, html, loadKatex]);
}
