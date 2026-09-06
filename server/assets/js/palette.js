// command palette: Cmd/Ctrl+K, queries /api/search, keyboard navigable

import {encodePath, esc, isMac, qs, qsa} from './dom.js';

const DEBOUNCE = 120;

let pending = null;
let items = [];
let at = -1;

function render(list, query) {
    const results = qs('#palette-results');
    const empty = qs('#palette-empty');
    items = list;
    at = list.length ? 0 : -1;
    results.innerHTML = list.map((hit, index) => (
        '<li class="palette-item' + (index === 0 ? ' is-active' : '') + '" role="option" id="palette-opt-' +
        index + '" aria-selected="' + (index === 0) + '">' +
        '<svg class="icon" aria-hidden="true"><use href="#icon-file"></use></svg>' +
        '<span class="palette-text">' +
        '<span class="palette-title">' + esc(hit.title || hit.path) + '</span>' +
        '<span class="palette-sub">' + (hit.snippet || esc(hit.path)) + '</span>' +
        '</span></li>'
    )).join('');
    qsa('.palette-item', results).forEach((node, index) => {
        node.addEventListener('click', () => open(index));
        node.addEventListener('mousemove', () => select(index));
    });
    if (empty) {
        empty.hidden = list.length > 0;
        empty.textContent = query
            ? 'Nothing found for «' + query + '». Press Enter for a full text search.'
            : 'Type to search documents and headings.';
    }
}

function select(index) {
    if (!items.length) return;
    at = (index + items.length) % items.length;
    const nodes = qsa('.palette-item');
    nodes.forEach((node, i) => {
        node.classList.toggle('is-active', i === at);
        node.setAttribute('aria-selected', String(i === at));
    });
    const input = qs('#palette-input');
    if (input) input.setAttribute('aria-activedescendant', 'palette-opt-' + at);
    if (nodes[at]) nodes[at].scrollIntoView({block: 'nearest'});
}

function open(index) {
    const hit = items[index];
    if (!hit) return;
    location.href = hit.url || ('/p/' + encodePath(hit.path));
}

async function run(query) {
    if (pending) pending.abort();
    if (!query) {
        render([], '');
        return;
    }
    pending = new AbortController();
    try {
        const res = await fetch('/api/search?q=' + encodeURIComponent(query) + '&limit=20',
            {signal: pending.signal, headers: {'Accept': 'application/json'}});
        if (!res.ok) throw new Error('search failed');
        const data = await res.json();
        render(Array.isArray(data.hits) ? data.hits : [], query);
    } catch (err) {
        if (err.name !== 'AbortError') render([], query);
    }
}

export function openPalette(prefill) {
    const dlg = qs('#palette');
    if (!dlg || dlg.open) return;
    const input = qs('#palette-input');
    dlg.showModal();
    if (prefill !== undefined) input.value = prefill;
    input.focus();
    input.select();
    run(input.value.trim());
}

export function initPalette() {
    const dlg = qs('#palette');
    if (!dlg) return;
    const input = qs('#palette-input');
    let timer = 0;

    // the triggers are links to /search so the page still searches without js
    qsa('[data-palette-open]').forEach((b) => b.addEventListener('click', (event) => {
        event.preventDefault();
        openPalette();
    }));
    qsa('[data-palette-close]').forEach((b) => b.addEventListener('click', () => dlg.close()));
    dlg.addEventListener('click', (event) => {
        if (event.target === dlg) dlg.close();
    });

    input.addEventListener('input', () => {
        clearTimeout(timer);
        timer = setTimeout(() => run(input.value.trim()), DEBOUNCE);
    });

    qs('[data-palette-form]').addEventListener('submit', (event) => {
        if (at >= 0 && items.length) {
            event.preventDefault();
            open(at);
        }
    });

    dlg.addEventListener('keydown', (event) => {
        if (event.key === 'ArrowDown') {
            event.preventDefault();
            select(at + 1);
        } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            select(at - 1);
        } else if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && items[at]) {
            event.preventDefault();
            window.open(items[at].url || ('/p/' + encodePath(items[at].path)), '_blank', 'noopener');
        }
    });

    qsa('[data-kbd-mod]').forEach((kbd) => {
        kbd.textContent = isMac ? '⌘' : 'Ctrl';
    });
}
