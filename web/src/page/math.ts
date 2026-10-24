import katex from 'katex';

import 'katex/dist/katex.min.css';

import { fontsReady, mathSelector, typeset } from '../reader/typeset';

window.scrawlKatex = katex;

document.addEventListener('DOMContentLoaded', () => {
  void (async () => {
    await fontsReady();
    for (const node of document.querySelectorAll<HTMLElement>(mathSelector)) {
      typeset(katex, node, node.textContent ?? '');
    }
  })();
});
