// global keyboard shortcuts and the cheat sheet

import {isMac, openDialog, qs, qsa} from './dom.js';
import {closeDrawer, drawerOpen, closeMenu} from './nav.js';
import {openPalette} from './palette.js';

const SHEET = [
    ['Global', [
        ['K', 'open search'],
        ['/', 'focus the sidebar filter'],
        ['e', 'edit the current page'],
        ['g then h', 'go home'],
        ['?', 'this cheat sheet'],
        ['Esc', 'close a dialog, menu or drawer']
    ]],
    ['Editor', [
        ['S', 'save'],
        ['B', 'bold'],
        ['I', 'italic'],
        ['K', 'insert a link'],
        ['E', 'inline code, with Shift a code block'],
        ['Shift P', 'toggle the preview'],
        ['Tab', 'indent, with Shift outdent'],
        ['Esc then Tab', 'move focus out of the text area']
    ]]
];

function typing(target) {
    if (!target) return false;
    const tag = target.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
}

function showSheet() {
    const mod = isMac ? '⌘' : 'Ctrl';
    const body = SHEET.map(([group, rows]) => (
        '<p class="modal-col-title">' + group + '</p><dl class="keys">' +
        rows.map(([keys, what]) => {
            const combo = /^[A-Z]$/.test(keys) || keys.startsWith('Shift ')
                ? mod + ' ' + keys
                : keys;
            const chips = combo.split(' ')
                .map((k) => k === 'then' ? '<span class="key-then">then</span>' : '<kbd>' + k + '</kbd>')
                .join(' ');
            return '<dt>' + chips + '</dt><dd>' + what + '</dd>';
        }).join('') + '</dl>'
    )).join('');
    openDialog(
        '<h2 class="modal-title">Keyboard shortcuts</h2>' + body +
        '<div class="modal-actions"><button class="btn btn-primary" type="button" data-act="ok">Close</button></div>'
    ).addEventListener('click', (event) => {
        if (event.target.dataset.act === 'ok') event.currentTarget.close();
    });
}

export function initShortcuts() {
    let pendingG = false;

    document.addEventListener('keydown', (event) => {
        if (event.defaultPrevented) return;
        // a modal dialog owns the keyboard. Every dialog here focuses a button,
        // which typing() does not catch, so without this "e" walks away from a
        // delete confirmation and "?" stacks the cheat sheet on top of it
        if (qs('dialog[open]')) return;
        const mod = isMac ? event.metaKey : event.ctrlKey;

        if (mod && !event.shiftKey && !event.altKey && event.key.toLowerCase() === 'k') {
            event.preventDefault();
            openPalette();
            return;
        }

        if (event.key === 'Escape') {
            closeMenu();
            if (drawerOpen()) {
                event.preventDefault();
                closeDrawer();
            }
            if (document.body.classList.contains('toc-open')) {
                document.body.classList.remove('toc-open');
                const pill = qs('[data-toc-toggle]');
                if (pill) pill.setAttribute('aria-expanded', 'false');
            }
            return;
        }

        if (typing(event.target) || event.metaKey || event.ctrlKey || event.altKey) return;

        if (event.key === '/') {
            const filter = qs('#tree-filter');
            if (filter) {
                event.preventDefault();
                if (window.innerWidth < 1000) {
                    qsa('[data-drawer-open]')[0] && qsa('[data-drawer-open]')[0].click();
                }
                filter.focus();
            }
            return;
        }

        if (event.key === '?') {
            event.preventDefault();
            showSheet();
            return;
        }

        if (event.key === 'e') {
            const edit = qs('.topbar-edit');
            if (edit) {
                event.preventDefault();
                location.href = edit.href;
            }
            return;
        }

        if (event.key === 'g') {
            pendingG = true;
            setTimeout(() => {
                pendingG = false;
            }, 900);
            return;
        }

        if (pendingG && event.key === 'h') {
            pendingG = false;
            location.href = '/';
        }
    });
}
