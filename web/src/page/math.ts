import katex from 'katex';

import 'katex/dist/katex.min.css';

import { fontsReady, mathSelector, typeset } from '../reader/typeset';

// typesets every formula of a page `scrawl render --math` or `scrawl diff
// --math` wrote, the way the app does once a note is on screen
document.addEventListener('DOMContentLoaded', () => {
  void (async () => {
    await fontsReady();
    for (const node of document.querySelectorAll<HTMLElement>(mathSelector)) {
      typeset(katex, node, node.textContent ?? '');
    }
  })();
});
