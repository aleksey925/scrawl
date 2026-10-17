export type Katex = typeof import('katex').default;

export const mathSelector = '.math';

const katexFaces = ['1em KaTeX_Main', 'italic 1em KaTeX_Math', '1em KaTeX_Size1', '1em KaTeX_AMS'];

// katex.min.css declares font-display: block, so typesetting before the faces
// arrive paints every formula blank and reflows the page when they land
export async function fontsReady(): Promise<void> {
  try {
    await Promise.all(katexFaces.map((face) => document.fonts.load(face)));
  } catch {
    // typeset anyway, the block period hides the glyphs only briefly
  }
}

export function typeset(katex: Katex, node: HTMLElement, tex: string): void {
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
