import katex from 'katex';

import 'katex/dist/katex.min.css';

import { fontsReady, mathSelector, typeset } from '../reader/typeset';

// a page of a site loads this file as its formula renderer and typesets with
// it the way the app does
window.scrawlKatex = katex;

// typesets every formula of a page `scrawl render --math` or `scrawl diff
// --math` wrote, the way the app does once a note is on screen; a page of a
// site loads this after the document is read, so this never runs there
document.addEventListener('DOMContentLoaded', () => {
  void (async () => {
    await fontsReady();
    for (const node of document.querySelectorAll<HTMLElement>(mathSelector)) {
      typeset(katex, node, node.textContent ?? '');
    }
  })();
});
