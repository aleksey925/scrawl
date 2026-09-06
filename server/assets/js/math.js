// math: the renderer leaves the raw TeX in .math-inline and .math-display, this
// turns it into typeset output with katex. The source stays on screen the whole
// time, so a failed download or a broken formula degrades to what the author
// wrote instead of to an empty box.

import {preserveScroll, qsa} from './dom.js';
import {assetURL, loadScript, loadStyle} from './lazy.js';

const KATEX_JS = assetURL('../vendor/katex/katex.min.js');
const KATEX_CSS = assetURL('../vendor/katex/katex.min.css');

export async function initMath(root) {
    const nodes = qsa('.math', root);
    if (!nodes.length) return;

    try {
        await Promise.all([loadStyle(KATEX_CSS), loadScript(KATEX_JS)]);
    } catch (e) {
        return;
    }
    if (!window.katex) return;

    // katex.min.css declares font-display: block, so typesetting before the
    // faces arrive would paint the formulas blank first and reflow when they
    // land. Waiting folds the whole thing into one repaint.
    await fontsReady();

    preserveScroll(root, () => nodes.forEach(typeset));
}

function typeset(node) {
    const tex = node.textContent;
    try {
        // katex paints its own error node with a style attribute, which
        // "style-src 'self'" refuses; throwing instead keeps the formula that
        // failed as the source the author wrote, marked up in our own palette
        window.katex.render(tex, node, {
            displayMode: node.classList.contains('math-display'),
            throwOnError: true,
            strict: 'ignore',
            output: 'htmlAndMathml',
            trust: false,
        });
        node.classList.add('is-typeset');
    } catch (e) {
        // katex empties the node before it builds, so put the source back
        node.textContent = tex;
        node.classList.add('is-error');
        node.title = (e && e.message) || 'this formula could not be parsed';
    }
}

async function fontsReady() {
    if (!document.fonts || !document.fonts.load) return;
    const faces = ['1em KaTeX_Main', 'italic 1em KaTeX_Math', '1em KaTeX_Size1', '1em KaTeX_AMS'];
    try {
        await Promise.all(faces.map((face) => document.fonts.load(face)));
    } catch (e) {
        // typeset anyway, the block period hides the glyphs only briefly
    }
}
