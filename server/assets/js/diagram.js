// diagrams: the renderer leaves the source in pre.mermaid, this renders it with
// mermaid and swaps the svg in. The source is never thrown away, so a download
// that fails, a diagram mermaid cannot parse, or scripting being off all end up
// showing the fence the author wrote.

import {preserveScroll, qsa} from './dom.js';
import {assetURL, loadScript} from './lazy.js';
import {isDarkTheme, onThemeChange} from './theme.js';

const MERMAID_JS = assetURL('../vendor/mermaid/mermaid.min.js');

const groups = new Map();
let watching = false;
let pass = 0;

// mermaid ships its theme as a <style> element inside the svg, and
// "style-src 'self'" drops any style element the page inserts. The css goes
// through the cssom instead, which the policy does not cover. Every rule
// mermaid writes is scoped to the diagram's own id, so one shared sheet holding
// the current pass is enough.
let sheet = null;

export function initDiagrams(root) {
    const blocks = qsa('pre.mermaid', root);
    if (!blocks.length) {
        groups.delete(root);
        return;
    }
    const items = blocks.map(wrap);
    groups.set(root, items);

    if (!watching) {
        watching = true;
        onThemeChange(() => groups.forEach(renderAll));
    }
    renderAll(items, root);
}

// wrap puts the fence in a box that can hold either the source or the svg, so
// switching between them never loses the original
function wrap(pre) {
    const box = document.createElement('div');
    box.className = 'diagram';
    pre.parentNode.insertBefore(box, pre);
    box.appendChild(pre);

    const view = document.createElement('div');
    view.className = 'diagram-view';
    box.appendChild(view);

    return {box, pre, view, source: pre.textContent};
}

async function renderAll(items, root) {
    preserveScroll(root, () => items.forEach((item) => state(item, 'pending')));

    try {
        await loadScript(MERMAID_JS);
        if (!window.mermaid) throw new Error('mermaid did not define itself');
    } catch (e) {
        items.forEach((item) => state(item, 'failed', 'Could not load the diagram renderer.'));
        return;
    }

    pass += 1;
    window.mermaid.initialize(config());

    const drawn = [];
    for (const item of items) {
        drawn.push(await draw(item, drawn.length));
    }
    preserveScroll(root, () => {
        const css = [];
        drawn.forEach((result) => css.push(place(result)));
        adopt(css.join('\n'));
    });
}

async function draw(item, index) {
    // a fresh id every pass: mermaid looks its scratch element up by id, and the
    // svg already on the page would answer for the previous one
    const id = 'mermaid-' + pass + '-' + index;
    try {
        const {svg} = await window.mermaid.render(id, item.source);
        return {item, svg};
    } catch (e) {
        // a parse failure leaves mermaid's scratch element behind
        const scratch = document.getElementById('d' + id);
        if (scratch) scratch.remove();
        return {item, error: firstLine(e)};
    }
}

// place installs one rendered diagram and returns the css that came with it
function place(result) {
    const {item, svg, error} = result;
    if (error) {
        state(item, 'failed', error);
        return '';
    }
    try {
        const {markup, css} = unstyle(svg);
        const doc = new DOMParser().parseFromString(markup, 'image/svg+xml');
        if (doc.querySelector('parsererror')) throw new Error('mermaid returned invalid svg');

        const root = document.importNode(doc.documentElement, true);
        restyle(root);
        item.view.replaceChildren(root);
        state(item, 'done');
        return css + repair(root.id);
    } catch (e) {
        state(item, 'failed', firstLine(e));
        return '';
    }
}

// mermaid 11.15 has no rule for the label inside an actor box, so the text
// takes its fill from ".actor", which is the fill of the box behind it, and a
// sequence diagram comes out with unreadable participant names in both themes.
// It has to be scoped to the same id, because mermaid's own rule is too.
function repair(id) {
    if (!id) return '';
    return '#' + id + ' text.actor > tspan { fill: ' + palette().text + '; stroke: none; }';
}

// unstyle takes the style element and every style attribute out of the markup.
// The policy refuses both the moment a parser applies them, and DOMParser is a
// parser like any other, so they have to travel as something inert and come
// back through the cssom on the other side.
function unstyle(svg) {
    const css = [];
    const markup = svg
        .replace(/<style[^>]*>([\s\S]*?)<\/style>/gi, (all, body) => {
            css.push(body);
            return '';
        })
        .replace(/ style="([^"]*)"/g, (all, value) => (value ? ' data-style="' + value + '"' : ''));
    return {markup, css: css.join('\n')};
}

function restyle(root) {
    const nodes = root.hasAttribute('data-style') ? [root] : [];
    nodes.push(...root.querySelectorAll('[data-style]'));
    nodes.forEach((node) => {
        node.style.cssText = node.getAttribute('data-style');
        node.removeAttribute('data-style');
    });
}

function adopt(css) {
    if (!css || !('adoptedStyleSheets' in document)) return;
    if (!sheet) {
        sheet = new CSSStyleSheet();
        document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
    }
    sheet.replaceSync(css);
}

function state(item, name, message) {
    item.box.className = 'diagram is-' + name;
    const old = item.box.querySelector('.diagram-error');
    if (old) old.remove();
    if (!message) return;
    const note = document.createElement('p');
    note.className = 'diagram-error';
    note.textContent = message;
    item.box.appendChild(note);
}

function firstLine(err) {
    const text = (err && err.message) || String(err);
    return text.split('\n')[0].slice(0, 200);
}

function palette() {
    const style = getComputedStyle(document.documentElement);
    const token = (name, fallback) => style.getPropertyValue(name).trim() || fallback;
    return {
        bg: token('--bg', '#ffffff'),
        inset: token('--bg-inset', '#f5f5f4'),
        subtle: token('--bg-subtle', '#f7f7f5'),
        text: token('--text', '#1d1d1f'),
        muted: token('--text-2', '#6e6e73'),
        faint: token('--text-3', '#8e8e93'),
        border: token('--border', '#e6e6e3'),
        strong: token('--border-strong', '#d2d2cf'),
        warn: token('--warning', '#9a6400'),
        warnBg: token('--warning-subtle', '#fdf3e0'),
        font: token('--font-sans', 'sans-serif'),
    };
}

// config paints mermaid with our own tokens, so a diagram belongs to the page in
// either theme rather than bringing its own palette
function config() {
    const c = palette();
    return {
        startOnLoad: false,
        securityLevel: 'strict',
        theme: 'base',
        fontFamily: c.font,
        // the base theme derives most of its palette, and what it derives from
        // near white surfaces comes out too pale to read, so every colour a
        // reader actually looks at is named here
        themeVariables: {
            darkMode: isDarkTheme(),
            fontSize: '14px',
            background: c.bg,
            primaryColor: c.inset,
            primaryTextColor: c.text,
            primaryBorderColor: c.strong,
            secondaryColor: c.subtle,
            tertiaryColor: c.subtle,
            mainBkg: c.inset,
            nodeBorder: c.strong,
            nodeTextColor: c.text,
            textColor: c.text,
            titleColor: c.text,
            lineColor: c.muted,
            edgeLabelBackground: c.bg,
            clusterBkg: c.subtle,
            clusterBorder: c.border,
            actorBkg: c.inset,
            actorBorder: c.strong,
            actorTextColor: c.text,
            actorLineColor: c.faint,
            signalColor: c.muted,
            signalTextColor: c.text,
            labelBoxBkgColor: c.inset,
            labelBoxBorderColor: c.strong,
            labelTextColor: c.text,
            loopTextColor: c.text,
            activationBkgColor: c.subtle,
            activationBorderColor: c.strong,
            noteBkgColor: c.warnBg,
            noteBorderColor: c.warn,
            noteTextColor: c.text,
        },
        // html labels are measured inside a live element, where the policy drops
        // the style attributes mermaid needs, and come out mispositioned.
        // useMaxWidth is off for the same reason: it is the one width that
        // mermaid writes as an inline style on the live svg, and .diagram-view
        // already holds the diagram to the column
        flowchart: {htmlLabels: false, useMaxWidth: false},
        class: {htmlLabels: false, useMaxWidth: false},
        sequence: {useMaxWidth: false},
        state: {useMaxWidth: false},
        er: {useMaxWidth: false},
        gantt: {useMaxWidth: false},
        pie: {useMaxWidth: false},
    };
}
