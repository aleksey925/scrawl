// small shared helpers: queries, JSON calls, toasts, dialogs, clipboard

export const qs = (sel, root = document) => root.querySelector(sel);
export const qsa = (sel, root = document) => Array.from(root.querySelectorAll(sel));

export const isMac = /mac|iphone|ipad|ipod/i.test(navigator.platform || navigator.userAgent);

const ESCAPES = {'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'};

export function esc(text) {
    return String(text).replace(/[&<>"']/g, (ch) => ESCAPES[ch]);
}

export function encodePath(path) {
    return String(path).split('/').map(encodeURIComponent).join('/');
}

export function dirOf(path) {
    const i = String(path).lastIndexOf('/');
    return i < 0 ? '' : path.slice(0, i);
}

export function formatBytes(bytes) {
    const n = Number(bytes);
    if (!isFinite(n)) return '';
    if (n < 1024) return n + ' B';
    const units = ['KB', 'MB', 'GB'];
    let value = n / 1024;
    let unit = 0;
    while (value >= 1024 && unit < units.length - 1) {
        value /= 1024;
        unit += 1;
    }
    return (value < 10 ? value.toFixed(1) : Math.round(value)) + ' ' + units[unit];
}

// api performs a same origin JSON call. CSRF is covered by the standard library
// cross origin protection, so no token header is needed.
export async function api(method, url, body) {
    const opts = {method, headers: {'Accept': 'application/json'}};
    if (body !== undefined) {
        opts.headers['Content-Type'] = 'application/json';
        opts.body = JSON.stringify(body);
    }
    const res = await fetch(url, opts);
    const text = await res.text();
    let data = null;
    if (text) {
        try {
            data = JSON.parse(text);
        } catch (e) {
            data = null;
        }
    }
    if (!res.ok) {
        const err = new Error((data && data.error) || res.statusText || 'request failed');
        err.status = res.status;
        err.data = data;
        throw err;
    }
    return data;
}

export function toast(message, kind) {
    const host = qs('#toasts');
    if (!host) return;
    const node = document.createElement('div');
    node.className = 'toast' + (kind ? ' is-' + kind : '');
    const icon = kind === 'success' ? '#icon-check' : kind === 'error' ? '#icon-warn' : '';
    node.innerHTML = (icon ? '<svg class="icon" aria-hidden="true"><use href="' + icon + '"></use></svg>' : '') +
        '<span></span>';
    node.lastElementChild.textContent = message;
    host.appendChild(node);
    setTimeout(() => node.remove(), kind === 'error' ? 5000 : 2400);
}

export function openDialog(html, className) {
    const dlg = document.createElement('dialog');
    dlg.className = className || 'modal';
    dlg.innerHTML = html;
    document.body.appendChild(dlg);
    dlg.addEventListener('close', () => dlg.remove());
    dlg.showModal();
    return dlg;
}

export function confirmDialog({title, text, confirmLabel = 'Confirm', danger = false}) {
    return new Promise((resolve) => {
        const dlg = openDialog(
            '<h2 class="modal-title"></h2>' +
            '<p class="modal-text"></p>' +
            '<div class="modal-actions">' +
            '<button class="btn btn-secondary" type="button" data-act="cancel">Cancel</button>' +
            '<button class="btn ' + (danger ? 'btn-danger' : 'btn-primary') + '" type="button" data-act="ok"></button>' +
            '</div>'
        );
        qs('.modal-title', dlg).textContent = title;
        qs('.modal-text', dlg).textContent = text;
        qs('[data-act="ok"]', dlg).textContent = confirmLabel;
        let answer = false;
        qs('[data-act="ok"]', dlg).addEventListener('click', () => {
            answer = true;
            dlg.close();
        });
        qs('[data-act="cancel"]', dlg).addEventListener('click', () => dlg.close());
        dlg.addEventListener('close', () => resolve(answer));
        // a destructive action must never be the focused default
        qs(danger ? '[data-act="cancel"]' : '[data-act="ok"]', dlg).focus();
    });
}

// formDialog shows a small form and resolves with {name: value} or null.
export function formDialog({title, text, fields, submitLabel = 'Create', onReady}) {
    return new Promise((resolve) => {
        const body = fields.map((f, i) => (
            '<label class="field">' +
            '<span class="field-label">' + esc(f.label) + '</span>' +
            '<input class="input' + (f.mono ? ' input-mono' : '') + '" name="' + esc(f.name) +
            '" value="' + esc(f.value || '') + '" placeholder="' + esc(f.placeholder || '') + '"' +
            (i === 0 ? ' autofocus' : '') +
            ' autocomplete="off" spellcheck="false">' +
            '</label>'
        )).join('');
        const dlg = openDialog(
            '<form method="dialog">' +
            '<h2 class="modal-title"></h2>' +
            (text ? '<p class="modal-text"></p>' : '') +
            body +
            '<div class="modal-actions">' +
            '<button class="btn btn-secondary" type="button" data-act="cancel">Cancel</button>' +
            '<button class="btn btn-primary" type="submit"></button>' +
            '</div></form>'
        );
        qs('.modal-title', dlg).textContent = title;
        if (text) qs('.modal-text', dlg).textContent = text;
        qs('[type="submit"]', dlg).textContent = submitLabel;

        let result = null;
        const form = qs('form', dlg);
        form.addEventListener('submit', (e) => {
            e.preventDefault();
            result = {};
            fields.forEach((f) => {
                result[f.name] = form.elements[f.name].value.trim();
            });
            dlg.close();
        });
        qs('[data-act="cancel"]', dlg).addEventListener('click', () => dlg.close());
        dlg.addEventListener('close', () => resolve(result));
        if (onReady) onReady(form);
        form.elements[fields[0].name].focus();
        form.elements[fields[0].name].select();
    });
}

export async function copyText(text) {
    try {
        if (navigator.clipboard && window.isSecureContext) {
            await navigator.clipboard.writeText(text);
            return true;
        }
    } catch (e) {
        // fall through to the legacy path below
    }
    // a NAS on plain http has no navigator.clipboard, so keep execCommand alive
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try {
        ok = document.execCommand('copy');
    } catch (e) {
        ok = false;
    }
    ta.remove();
    return ok;
}

// preserveScroll runs a layout changing update and then scrolls by however far
// the visible content moved. Typeset math and a rendered diagram are much
// taller than the source they replace, and without this the page jumps out from
// under a reader who is already somewhere below them.
export function preserveScroll(root, update) {
    const anchor = Array.from(root.children).find((el) => el.getBoundingClientRect().bottom > 0);
    const scroller = scrollerOf(root);
    const before = anchor ? anchor.getBoundingClientRect().top : 0;
    update();
    if (!anchor) return;
    const delta = anchor.getBoundingClientRect().top - before;
    // instant, because html carries scroll-behavior: smooth and animating the
    // correction is exactly the movement this exists to hide
    if (Math.abs(delta) > 1) scroller.scrollBy({top: delta, behavior: 'instant'});
}

// the reading view scrolls the window, the editor preview pane scrolls itself
function scrollerOf(el) {
    for (let node = el.parentElement; node; node = node.parentElement) {
        const overflow = getComputedStyle(node).overflowY;
        if ((overflow === 'auto' || overflow === 'scroll') && node.scrollHeight > node.clientHeight) {
            return node;
        }
    }
    return window;
}

export function debounce(fn, wait) {
    let timer = 0;
    return function (...args) {
        clearTimeout(timer);
        timer = setTimeout(() => fn.apply(this, args), wait);
    };
}

// slugify turns a page title into an ascii file name, transliterating Cyrillic
// so new files match the kebab-case names already in the corpus. The table is
// the one store/upload.go uses for attachment names, letter for letter: a page
// and the image beside it must not romanize the same word two ways.
const TRANSLIT = {
    'а': 'a', 'б': 'b', 'в': 'v', 'г': 'g', 'д': 'd', 'е': 'e', 'ё': 'e', 'ж': 'zh',
    'з': 'z', 'и': 'i', 'й': 'y', 'к': 'k', 'л': 'l', 'м': 'm', 'н': 'n', 'о': 'o',
    'п': 'p', 'р': 'r', 'с': 's', 'т': 't', 'у': 'u', 'ф': 'f', 'х': 'h', 'ц': 'ts',
    'ч': 'ch', 'ш': 'sh', 'щ': 'shch', 'ъ': '', 'ы': 'y', 'ь': '', 'э': 'e',
    'ю': 'yu', 'я': 'ya'
};

export function slugify(title) {
    const lower = String(title).toLowerCase();
    let out = '';
    for (const ch of lower) {
        out += TRANSLIT[ch] !== undefined ? TRANSLIT[ch] : ch;
    }
    return out.replace(/[^a-z0-9.-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
}
