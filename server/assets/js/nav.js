// sidebar: mobile drawer, live filter, file operations and the top bar shadow

import {
    api, confirmDialog, copyText, encodePath, esc, formatBytes, formDialog,
    qs, qsa, slugify, toast
} from './dom.js';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';
const SWIPE_THRESHOLD = 20;

let lastFocused = null;

// the sidebar carries the read-only flag, so every write affordance the script
// builds can ask one question before offering anything the api would refuse
function canWrite() {
    const sidebar = qs('#sidebar');
    return !!sidebar && !sidebar.hasAttribute('data-readonly');
}

export function drawerOpen() {
    return document.body.classList.contains('drawer-open');
}

export function openDrawer() {
    const sidebar = qs('#sidebar');
    if (!sidebar || drawerOpen()) return;
    lastFocused = document.activeElement;
    document.body.classList.add('drawer-open');
    sidebar.setAttribute('role', 'dialog');
    sidebar.setAttribute('aria-modal', 'true');
    qsa('[data-drawer-open]').forEach((b) => b.setAttribute('aria-expanded', 'true'));
    setBackgroundInert(true);
    const close = qs('[data-drawer-close]', sidebar);
    (close || sidebar).focus();
}

export function closeDrawer() {
    const sidebar = qs('#sidebar');
    if (!sidebar || !drawerOpen()) return;
    document.body.classList.remove('drawer-open');
    sidebar.removeAttribute('role');
    sidebar.removeAttribute('aria-modal');
    qsa('[data-drawer-open]').forEach((b) => b.setAttribute('aria-expanded', 'false'));
    setBackgroundInert(false);
    if (lastFocused && lastFocused.isConnected) lastFocused.focus();
}

function setBackgroundInert(on) {
    qsa('.topbar, .main, .toc-rail, .toc-pill').forEach((el) => {
        if (on) {
            el.setAttribute('inert', '');
        } else {
            el.removeAttribute('inert');
        }
    });
}

function trapTab(event) {
    const sidebar = qs('#sidebar');
    if (!drawerOpen() || event.key !== 'Tab' || !sidebar) return;
    const items = qsa(FOCUSABLE, sidebar).filter((el) => el.offsetParent !== null);
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
    }
}

/* --- swipe the drawer shut ---------------------------------------------- */

let swipedAt = 0;

function initSwipeClose(sidebar) {
    let startX = 0;
    let startY = 0;
    let shift = 0;
    let tracking = false;
    let sliding = false;

    const release = (finished) => {
        if (!tracking) return;
        tracking = false;
        sidebar.style.transition = '';
        sidebar.style.transform = '';
        if (!sliding) return;
        sliding = false;
        swipedAt = Date.now();
        if (finished && shift <= -SWIPE_THRESHOLD) closeDrawer();
    };

    sidebar.addEventListener('pointerdown', (event) => {
        if (!drawerOpen()) return;
        tracking = true;
        sliding = false;
        shift = 0;
        startX = event.clientX;
        startY = event.clientY;
    });

    sidebar.addEventListener('pointermove', (event) => {
        if (!tracking) return;
        shift = Math.min(0, event.clientX - startX);
        if (!sliding) {
            const moved = Math.abs(event.clientX - startX);
            const scrolled = Math.abs(event.clientY - startY);
            if (moved < SWIPE_THRESHOLD && scrolled < SWIPE_THRESHOLD) return;
            if (moved <= scrolled) {
                tracking = false;
                return;
            }
            sliding = true;
            sidebar.style.transition = 'none';
            sidebar.setPointerCapture(event.pointerId);
        }
        sidebar.style.transform = 'translateX(' + shift + 'px)';
    });

    sidebar.addEventListener('pointerup', () => release(true));
    // the browser took the gesture over, so put the panel back where it was
    sidebar.addEventListener('pointercancel', () => release(false));

    // touch-action: pan-y is not enough on chromium: it still claims the
    // gesture a couple of moves in and cancels the pointer stream, which leaves
    // the panel stranded half open. pointermove runs first, so by the time this
    // fires the swipe is already recognised and safe to keep
    sidebar.addEventListener('touchmove', (event) => {
        if (sliding) event.preventDefault();
    }, {passive: false});

    // a swipe that starts on a row would otherwise open the page it ended on
    sidebar.addEventListener('click', (event) => {
        if (Date.now() - swipedAt > 400) return;
        event.preventDefault();
        event.stopPropagation();
    }, true);
}

/* --- live filter over the tree ----------------------------------------- */

function markMatch(node, name, query) {
    if (!query) {
        node.textContent = name;
        return;
    }
    const at = name.toLowerCase().indexOf(query);
    if (at < 0) {
        node.textContent = name;
        return;
    }
    node.innerHTML = esc(name.slice(0, at)) + '<mark>' + esc(name.slice(at, at + query.length)) +
        '</mark>' + esc(name.slice(at + query.length));
}

function initFilter() {
    const input = qs('#tree-filter');
    const sidebar = qs('#sidebar');
    if (!input || !sidebar) return;
    const empty = qs('#tree-empty');
    const openBefore = new WeakMap();

    input.addEventListener('input', () => {
        const query = input.value.trim().toLowerCase();
        let visible = 0;

        qsa('.tree-name', sidebar).forEach((node) => {
            markMatch(node, node.dataset.name || (node.dataset.name = node.textContent), query);
        });

        const walk = (item) => {
            const details = item.querySelector(':scope > .tree-dir');
            const label = item.querySelector(':scope > .tree-dir > .tree-row .tree-name, :scope > .tree-row .tree-name');
            const name = (label && (label.dataset.name || label.textContent)) || '';
            const self = !query || name.toLowerCase().includes(query);
            let childHit = false;
            qsa(':scope > .tree-dir > .tree > .tree-item', item).forEach((child) => {
                childHit = walk(child) || childHit;
            });
            const show = self || childHit;
            item.hidden = !show;
            if (details) {
                if (query) {
                    if (!openBefore.has(details)) openBefore.set(details, details.open);
                    details.open = childHit || self;
                } else if (openBefore.has(details)) {
                    details.open = openBefore.get(details);
                    openBefore.delete(details);
                }
            } else if (show) {
                visible += 1;
            }
            return show;
        };

        qsa('.sidebar-scroll > .tree > .tree-item', sidebar).forEach(walk);
        if (empty) empty.hidden = !(query && visible === 0);
    });

    input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
            event.preventDefault();
            const first = qsa('.tree-item:not([hidden]) .tree-link', sidebar)[0];
            if (first) {
                first.click();
                return;
            }
            location.href = '/search?q=' + encodeURIComponent(input.value);
        }
        if (event.key === 'Escape' && input.value) {
            event.stopPropagation();
            input.value = '';
            input.dispatchEvent(new Event('input'));
        }
    });
}

/* --- remember which folders are open ------------------------------------ */

const OPEN_KEY = 'scrawl.tree.open';

function readOpen() {
    try {
        const raw = localStorage.getItem(OPEN_KEY);
        return raw ? new Set(JSON.parse(raw)) : null;
    } catch (e) {
        return null;
    }
}

function initTreeState() {
    const saved = readOpen();
    if (saved) {
        qsa('.tree-dir').forEach((d) => {
            // an ancestor of the current page stays open whatever was stored
            if (!d.open) d.open = saved.has(d.dataset.path);
        });
    }
    qsa('.tree-dir').forEach((d) => d.addEventListener('toggle', () => {
        try {
            const open = qsa('.tree-dir').filter((x) => x.open).map((x) => x.dataset.path);
            localStorage.setItem(OPEN_KEY, JSON.stringify(open));
        } catch (e) {
            // private mode, the tree just will not remember its state
        }
    }));
}

/* --- file operations ---------------------------------------------------- */

function fileURL(path) {
    return '/api/file/' + encodePath(path);
}

async function createPage(folder) {
    const answer = await formDialog({
        title: 'New page',
        fields: [
            {name: 'folder', label: 'Folder', value: folder || '', placeholder: 'root', mono: true},
            {name: 'title', label: 'Title', value: '', placeholder: 'Replication'},
            {name: 'file', label: 'File name', value: '', placeholder: 'replication.md', mono: true}
        ],
        submitLabel: 'Create',
        onReady: (form) => {
            let touched = false;
            form.elements.file.addEventListener('input', () => {
                touched = true;
            });
            form.elements.title.addEventListener('input', () => {
                if (touched) return;
                const name = slugify(form.elements.title.value);
                form.elements.file.value = name ? name + '.md' : '';
            });
        }
    });
    if (!answer) return;
    let name = answer.file || slugify(answer.title);
    if (!name) {
        toast('A title or a file name is required', 'error');
        return;
    }
    if (!name.endsWith('.md')) name += '.md';
    const path = answer.folder ? answer.folder.replace(/\/+$/, '') + '/' + name : name;
    try {
        await api('POST', fileURL(path), {type: 'file'});
        location.href = '/edit/' + encodePath(path);
    } catch (err) {
        toast(err.status === 409 ? 'That page already exists' : err.message, 'error');
    }
}

async function createFolder(parent) {
    const answer = await formDialog({
        title: 'New folder',
        fields: [
            {name: 'parent', label: 'Inside', value: parent || '', placeholder: 'root', mono: true},
            {name: 'name', label: 'Folder name', value: '', placeholder: 'databases'}
        ],
        submitLabel: 'Create'
    });
    if (!answer || !answer.name) return;
    const name = slugify(answer.name) || answer.name;
    const path = answer.parent ? answer.parent.replace(/\/+$/, '') + '/' + name : name;
    try {
        await api('POST', fileURL(path), {type: 'dir'});
        toast('Folder created', 'success');
        await refreshTree();
    } catch (err) {
        toast(err.status === 409 ? 'That folder already exists' : err.message, 'error');
    }
}

async function renamePath(path) {
    const answer = await formDialog({
        title: 'Rename or move',
        text: 'Links in other documents are not rewritten yet, so check them afterwards.',
        fields: [{name: 'to', label: 'New path', value: path, mono: true}],
        submitLabel: 'Rename'
    });
    if (!answer || !answer.to || answer.to === path) return;
    try {
        const res = await api('POST', '/api/move', {from: path, to: answer.to});
        toast('Renamed', 'success');
        const target = (res && res.path) || answer.to;
        if (currentPath() === path) {
            location.href = '/p/' + encodePath(target);
            return;
        }
        await refreshTree();
    } catch (err) {
        toast(err.status === 409 ? 'The target already exists' : err.message, 'error');
    }
}

async function deletePath(path, kind) {
    const ok = await confirmDialog({
        title: 'Delete ' + (kind === 'dir' ? 'folder' : 'page') + '?',
        text: path + ' will be removed. This cannot be undone from the browser.',
        confirmLabel: 'Delete',
        danger: true
    });
    if (!ok) return;
    try {
        await api('DELETE', fileURL(path));
        toast('Deleted', 'success');
        if (currentPath() === path) {
            location.href = '/';
            return;
        }
        await refreshTree();
    } catch (err) {
        toast(err.status === 409 ? 'The folder is not empty' : err.message, 'error');
    }
}

function currentPath() {
    const holder = qs('#doc') || qs('#editor') || qs('#dir');
    return holder ? holder.dataset.path : '';
}

/* --- row context menu --------------------------------------------------- */

let openMenu = null;

// a folder row is a <summary>, where a nested <button> would fight the
// disclosure widget for the click, so it gets a span with the button role
function rowMenuTrigger(path, kind, name) {
    const el = document.createElement(kind === 'dir' ? 'span' : 'button');
    if (kind === 'dir') {
        el.setAttribute('role', 'button');
        el.tabIndex = 0;
    } else {
        el.type = 'button';
    }
    el.className = 'tree-more';
    el.dataset.actions = path;
    el.dataset.kind = kind;
    el.setAttribute('aria-label', 'Actions for ' + name);
    el.innerHTML = '<svg class="icon" aria-hidden="true"><use href="#icon-more"></use></svg>';
    return el;
}

function initRowMenus() {
    if (!canWrite()) return;
    qsa('#sidebar .tree-row').forEach((row) => {
        if (qs('.tree-more', row)) return;
        const dir = row.tagName === 'SUMMARY';
        const holder = dir ? row.parentElement : row;
        const label = qs('.tree-name', row);
        row.appendChild(rowMenuTrigger(holder.dataset.path, dir ? 'dir' : 'file',
            (label && label.textContent) || ''));
    });
}

function closeMenu() {
    if (!openMenu) return;
    openMenu.trigger.setAttribute('aria-expanded', 'false');
    openMenu.node.remove();
    openMenu = null;
}

function buildMenu(path, kind) {
    const items = [];
    if (kind === 'file') {
        items.push({label: 'Open', icon: '#icon-file', run: () => location.href = '/p/' + encodePath(path)});
        items.push({label: 'Edit', icon: '#icon-edit', run: () => location.href = '/edit/' + encodePath(path)});
    } else {
        items.push({label: 'New page here', icon: '#icon-plus', run: () => createPage(path)});
        items.push({label: 'New folder', icon: '#icon-folder-plus', run: () => createFolder(path)});
    }
    items.push({separator: true});
    items.push({label: 'Rename', icon: '#icon-edit', run: () => renamePath(path)});
    items.push({
        label: 'Copy link', icon: '#icon-link', run: async () => {
            const url = location.origin + (kind === 'file' ? '/p/' + encodePath(path) : '/p/' + encodePath(path) + '/');
            toast(await copyText(url) ? 'Link copied' : 'Could not copy the link', 'success');
        }
    });
    items.push({separator: true});
    items.push({label: 'Delete', icon: '#icon-trash', danger: true, run: () => deletePath(path, kind)});
    return items;
}

function showMenu(trigger) {
    const path = trigger.dataset.actions;
    const kind = trigger.dataset.kind;
    closeMenu();
    const items = buildMenu(path, kind);
    const node = document.createElement('div');
    node.className = 'menu menu-float';
    node.setAttribute('role', 'menu');
    node.innerHTML = items.map((item) => item.separator
        ? '<div class="menu-sep"></div>'
        : '<button class="menu-item' + (item.danger ? ' is-danger' : '') + '" type="button" role="menuitem">' +
        '<svg class="icon" aria-hidden="true"><use href="' + item.icon + '"></use></svg>' +
        '<span>' + esc(item.label) + '</span></button>').join('');
    document.body.appendChild(node);

    const rect = trigger.getBoundingClientRect();
    const width = node.offsetWidth;
    const height = node.offsetHeight;
    const left = Math.min(Math.max(8, rect.right - width), window.innerWidth - width - 8);
    const top = rect.bottom + height + 8 > window.innerHeight
        ? Math.max(8, rect.top - height - 4)
        : rect.bottom + 4;
    node.style.left = left + 'px';
    node.style.top = top + 'px';

    const buttons = qsa('.menu-item', node);
    items.filter((i) => !i.separator).forEach((item, i) => {
        buttons[i].addEventListener('click', () => {
            closeMenu();
            item.run();
        });
    });
    node.addEventListener('keydown', (event) => {
        const at = buttons.indexOf(document.activeElement);
        if (event.key === 'ArrowDown') {
            event.preventDefault();
            buttons[(at + 1) % buttons.length].focus();
        } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            buttons[(at - 1 + buttons.length) % buttons.length].focus();
        } else if (event.key === 'Escape') {
            event.stopPropagation();
            const back = trigger;
            closeMenu();
            back.focus();
        }
    });
    trigger.setAttribute('aria-expanded', 'true');
    openMenu = {node, trigger};
    buttons[0].focus();
}

/* --- rebuild the tree after a change ------------------------------------ */

function renderNodes(nodes, here) {
    return '<ul class="tree">' + nodes.map((node) => {
        const name = esc(String(node.name || '').replace(/\.md$/, ''));
        if (node.is_dir) {
            const at = here === node.path;
            const open = at || (here && here.startsWith(node.path + '/'));
            return '<li class="tree-item"><details class="tree-dir" data-path="' + esc(node.path) + '"' +
                (open ? ' open' : '') + '><summary class="tree-row' + (at ? ' is-current' : '') + '">' +
                '<svg class="icon tree-twisty" aria-hidden="true"><use href="#icon-chevron"></use></svg>' +
                '<a class="tree-link" href="/p/' + encodePath(node.path) + '/"' +
                (at ? ' aria-current="page"' : '') + '>' +
                '<svg class="icon tree-kind" aria-hidden="true"><use href="#icon-folder"></use></svg>' +
                '<span class="tree-name">' + name + '</span></a>' +
                '</summary>' + renderNodes(node.children || [], here) + '</details></li>';
        }
        const current = here === node.path;
        return '<li class="tree-item"><div class="tree-row tree-leaf' + (current ? ' is-current' : '') +
            '" data-path="' + esc(node.path) + '">' +
            '<a class="tree-link" href="/p/' + encodePath(node.path) + '"' + (current ? ' aria-current="page"' : '') + '>' +
            '<svg class="icon tree-kind" aria-hidden="true"><use href="#icon-file"></use></svg>' +
            '<span class="tree-name">' + name + '</span></a></div></li>';
    }).join('') + '</ul>';
}

export async function refreshTree() {
    const host = qs('.sidebar-scroll');
    if (!host) return;
    try {
        const data = await api('GET', '/api/tree');
        if (!data || !Array.isArray(data.tree)) throw new Error('bad tree payload');
        const empty = qs('#tree-empty');
        const old = qs('.sidebar-scroll > .tree');
        const markup = renderNodes(data.tree, currentPath());
        if (old) {
            old.outerHTML = markup;
        } else {
            host.insertAdjacentHTML('afterbegin', markup);
        }
        if (empty) host.appendChild(empty);
        initTreeState();
        initRowMenus();
    } catch (e) {
        location.reload();
    }
}

/* --- popover menus in the top bar --------------------------------------- */

function initPopovers() {
    qsa('[data-menu-open]').forEach((trigger) => {
        const panel = document.getElementById(trigger.dataset.menuOpen);
        if (!panel) return;
        trigger.addEventListener('click', (event) => {
            event.stopPropagation();
            const show = panel.hidden;
            panel.hidden = !show;
            trigger.setAttribute('aria-expanded', String(show));
        });
        document.addEventListener('click', (event) => {
            if (panel.hidden || panel.contains(event.target) || trigger.contains(event.target)) return;
            panel.hidden = true;
            trigger.setAttribute('aria-expanded', 'false');
        });
    });
}

export function initNav() {
    qsa('[data-drawer-open]').forEach((b) => b.addEventListener('click', openDrawer));
    qsa('[data-drawer-close]').forEach((b) => b.addEventListener('click', closeDrawer));
    const sidebar = qs('#sidebar');
    if (sidebar) {
        sidebar.addEventListener('click', (event) => {
            const link = event.target.closest('.tree-link');
            if (!link) return;
            const folder = link.closest('.tree-dir');
            // a section label opens its folder page and expands the row; only
            // the disclosure triangle beside it may collapse again
            if (folder && !event.metaKey && !event.ctrlKey && !event.shiftKey) {
                event.preventDefault();
                folder.open = true;
                location.href = link.href;
                return;
            }
            if (window.innerWidth < 1000) closeDrawer();
        });
        initSwipeClose(sidebar);
    }
    document.addEventListener('keydown', trapTab);

    initFilter();
    initTreeState();
    initRowMenus();
    initPopovers();

    document.addEventListener('click', (event) => {
        const trigger = event.target.closest('[data-actions]');
        if (trigger) {
            event.preventDefault();
            event.stopPropagation();
            if (openMenu && openMenu.trigger === trigger) {
                closeMenu();
            } else {
                showMenu(trigger);
            }
            return;
        }
        if (openMenu && !openMenu.node.contains(event.target)) closeMenu();
    });

    document.addEventListener('keydown', (event) => {
        const trigger = event.target.closest && event.target.closest('[data-actions]');
        if (trigger && (event.key === 'Enter' || event.key === ' ')) {
            event.preventDefault();
            showMenu(trigger);
        }
    });

    qsa('[data-new-page]').forEach((b) => b.addEventListener('click', () => createPage(b.dataset.newPage)));
    qsa('[data-new-folder]').forEach((b) => b.addEventListener('click', () => createFolder(b.dataset.newFolder)));

    // pretty sizes in the directory listing, bytes stay in the markup for no-js
    qsa('.entry-size[data-bytes]').forEach((el) => {
        el.textContent = formatBytes(el.dataset.bytes);
    });

    const topbar = qs('.topbar');
    if (topbar) {
        const onScroll = () => {
            topbar.classList.toggle('is-scrolled', window.scrollY > 4);
            document.body.classList.toggle('scrolled-far', window.scrollY > 600);
        };
        window.addEventListener('scroll', onScroll, {passive: true});
        onScroll();
    }

    window.addEventListener('resize', () => {
        if (window.innerWidth >= 1000 && drawerOpen()) closeDrawer();
    });
}

export {closeMenu};
