export type Katex = typeof import('katex').default;

export const mathSelector = '.math';

const katexFaces = ['1em KaTeX_Main', 'italic 1em KaTeX_Math', '1em KaTeX_Size1', '1em KaTeX_AMS'];

export async function fontsReady(): Promise<void> {
  try {
    await Promise.all(katexFaces.map((face) => document.fonts.load(face)));
  } catch {
  }
}

export function typeset(katex: Katex, node: HTMLElement, tex: string): void {
  try {
    katex.render(tex, node, {
      displayMode: node.classList.contains('math-display'),
      throwOnError: true,
      strict: 'ignore',
      output: 'htmlAndMathml',
      trust: false,
    });
    node.classList.add('is-typeset');
  } catch (error) {
    node.textContent = tex;
    node.classList.add('is-error');
    node.title = error instanceof Error ? error.message : 'this formula could not be parsed';
  }
}
