// command palette: Cmd/Ctrl+K, queries /api/search, keyboard navigable

import {encodePath, esc, isMac, qs, qsa} from './dom.js';

const DEBOUNCE = 120;

let pending = null;
let items = [];
let at = -1;

// the dialog is resolved once, by shape rather than by id, and everything in it
// is looked up underneath it. A note with a heading "Palette input" slugs to
// id="palette-input" and is rendered before this chrome, so a document-wide
// lookup would hand back the heading. class is no safer: the sanitiser lets
// content carry any class it likes.
let root = null;

const inside = (sel) => (root ? root.querySelector(sel) : null);

function render(list, query) {
    const results = inside('.palette-results');
    const empty = inside('.palette-empty');
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
    const input = inside('.palette-input');
    if (input && at >= 0) {
        input.setAttribute('aria-activedescendant', 'palette-opt-' + at);
    } else if (input) {
        input.removeAttribute('aria-activedescendant');
    }
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
    const nodes = qsa('.palette-item', root);
    nodes.forEach((node, i) => {
        node.classList.toggle('is-active', i === at);
        node.setAttribute('aria-selected', String(i === at));
    });
    const input = inside('.palette-input');
    if (input) input.setAttribute('aria-activedescendant', 'palette-opt-' + at);
    if (nodes[at]) nodes[at].scrollIntoView({block: 'nearest'});
}

function open(index) {
    const hit = items[index];
    if (!hit) return;
    location.href = hit.url || ('/p/' + encodePath(hit.path));
}

// a search that failed must not read as one that found nothing: "your notes do
// not have this word" and "the server never answered" call for opposite moves
function fail() {
    const results = inside('.palette-results');
    const empty = inside('.palette-empty');
    items = [];
    at = -1;
    results.innerHTML = '';
    const input = inside('.palette-input');
    if (input) input.removeAttribute('aria-activedescendant');
    if (empty) {
        empty.hidden = false;
        empty.textContent = 'The search could not be reached. Check the connection and try again.';
    }
}

async function run(query) {
    if (pending) pending.abort();
    if (!query) {
        render([], '');
        return;
    }
    pending = new AbortController();
    const results = inside('.palette-results');
    results.setAttribute('aria-busy', 'true');
    try {
        const res = await fetch('/api/search?q=' + encodeURIComponent(query) + '&limit=20',
            {signal: pending.signal, headers: {'Accept': 'application/json'}});
        if (!res.ok) throw new Error('search failed');
        const data = await res.json();
        render(Array.isArray(data.hits) ? data.hits : [], query);
    } catch (err) {
        if (err.name !== 'AbortError') fail();
    } finally {
        results.setAttribute('aria-busy', 'false');
    }
}

export function openPalette(prefill) {
    const dlg = root;
    if (!dlg || dlg.open) return;
    const input = inside('.palette-input');
    dlg.showModal();
    input.setAttribute('aria-expanded', 'true');
    if (prefill !== undefined) input.value = prefill;
    input.focus();
    input.select();
    run(input.value.trim());
}

export function initPalette() {
    root = qs('body > #palette');
    const dlg = root;
    if (!dlg) return;
    const input = inside('.palette-input');
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
    dlg.addEventListener('close', () => input.setAttribute('aria-expanded', 'false'));

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
