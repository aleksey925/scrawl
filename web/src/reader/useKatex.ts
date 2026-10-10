import { useEffect, type RefObject } from 'react';

import { preserveScroll } from './scroll';

type Katex = typeof import('katex').default;

const mathSelector = '.math';

const katexFaces = ['1em KaTeX_Main', 'italic 1em KaTeX_Math', '1em KaTeX_Size1', '1em KaTeX_AMS'];

// katex.min.css declares font-display: block, so typesetting before the faces
// arrive paints every formula blank and reflows the page when they land
async function fontsReady(): Promise<void> {
  try {
    await Promise.all(katexFaces.map((face) => document.fonts.load(face)));
  } catch {
    // typeset anyway, the block period hides the glyphs only briefly
  }
}

function typeset(katex: Katex, node: HTMLElement, tex: string): void {
  try {
    // katex paints its own error node with a style attribute, which the policy
    // refuses; throwing keeps the source the author wrote on screen instead
    katex.render(tex, node, {
      displayMode: node.classList.contains('math-display'),
      throwOnError: true,
      strict: 'ignore',
      output: 'htmlAndMathml',
      trust: false,
    });
    node.classList.add('is-typeset');
  } catch (error) {
    // katex empties the node before it builds, so put the source back
    node.textContent = tex;
    node.classList.add('is-error');
    node.title = error instanceof Error ? error.message : 'this formula could not be parsed';
  }
}

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
