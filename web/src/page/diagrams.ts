import mermaid from 'mermaid';

import { drawDiagrams } from '../reader/diagrams';
import { lookupTheme, themeAttribute } from '../themes';

const darkQuery = '(prefers-color-scheme: dark)';

function dark(): boolean {
  const choice = document.documentElement.getAttribute(themeAttribute);
  const scheme = choice === null ? undefined : lookupTheme(choice)?.scheme;
  return (scheme ?? (window.matchMedia(darkQuery).matches ? 'dark' : 'light')) === 'dark';
}

let cancel = (): void => {};

function draw(): void {
  cancel();
  const note = document.querySelector<HTMLElement>('article.markdown-document');
  if (note !== null) {
    cancel = drawDiagrams(note, () => Promise.resolve(mermaid), dark());
  }
}

draw();
// a diagram is painted with the tokens of the theme, so it is drawn again when
// the picker moves the attribute or the system turns dark
new MutationObserver(draw).observe(document.documentElement, { attributes: true, attributeFilter: [themeAttribute] });
window.matchMedia(darkQuery).addEventListener('change', draw);
