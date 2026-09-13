// reading view: code copy buttons, heading anchors, the image lightbox, the
// outline sheet and TOC scrollspy

import {copyText, qs, qsa, toast} from './dom.js';
import {initDiagrams} from './diagram.js';
import {initMath} from './math.js';

// the corpus fences carry a few labels chroma does not know
const LANG_ALIASES = {
    'с': 'c', 'docker-compose': 'yaml', 'cmd': 'batch', 'regexp': 'regex',
    'sh': 'bash', 'shell': 'bash', 'yml': 'yaml'
};

function languageOf(code) {
    let name = code.dataset.lang || '';
    if (!name) {
        const match = /(?:^|\s)(?:language|lang)-([\w+.#-]+)/.exec(code.className || '');
        if (match) name = match[1];
    }
    name = name.toLowerCase();
    if (!name || name === 'text' || name === 'plaintext' || name === 'fallback') return '';
    return LANG_ALIASES[name] || name;
}

// the renderer already wraps fences in .code-block[data-lang]; wrapping here is
// only the fallback for html that came from somewhere else
export function enhanceCode(root) {
    // a mermaid fence is source for diagram.js, not something to copy
    qsa('pre:not(.mermaid)', root).forEach((pre) => {
        const code = pre.querySelector('code') || pre;
        let block = pre.closest('.code-block');
        if (!block) {
            block = document.createElement('div');
            block.className = 'code-block';
            pre.parentNode.insertBefore(block, pre);
            block.appendChild(pre);
            const lang = languageOf(code);
            if (lang) block.dataset.lang = lang;
        }
        if (block.querySelector('.code-copy')) return;

        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'code-copy';
        button.setAttribute('aria-label', 'Copy code');
        button.innerHTML = '<svg class="icon" aria-hidden="true"><use href="#icon-copy"></use></svg>';
        button.addEventListener('click', async () => {
            const ok = await copyText(code.textContent);
            if (!ok) {
                toast('Could not copy the code', 'error');
                return;
            }
            button.classList.add('is-done');
            // the swapped icon is the only sign it worked, and it is aria-hidden
            button.setAttribute('aria-label', 'Copied');
            button.innerHTML = '<svg class="icon" aria-hidden="true"><use href="#icon-check"></use></svg>';
            setTimeout(() => {
                button.classList.remove('is-done');
                button.setAttribute('aria-label', 'Copy code');
                button.innerHTML = '<svg class="icon" aria-hidden="true"><use href="#icon-copy"></use></svg>';
            }, 1500);
        });
        block.appendChild(button);
    });
}

function enhanceHeadings(root) {
    qsa('h1[id], h2[id], h3[id], h4[id], h5[id], h6[id]', root).forEach((heading) => {
        if (heading.querySelector('.anchor')) return;
        const link = document.createElement('a');
        link.className = 'anchor';
        link.href = '#' + heading.id;
        link.textContent = '#';
        link.setAttribute('aria-label', 'Link to this section');
        link.addEventListener('click', async (event) => {
            event.preventDefault();
            const url = location.origin + location.pathname + '#' + heading.id;
            history.replaceState(null, '', '#' + heading.id);
            heading.scrollIntoView();
            toast(await copyText(url) ? 'Link copied' : 'Could not copy the link', 'success');
        });
        // ahead of the text, which is where the gutter is and where a reader
        // looks for it; trailing it also put the hash after a wrapped last line
        heading.prepend(link);
    });
}

/* --- lightbox ----------------------------------------------------------- */

function initLightbox(root) {
    const dlg = qs('#lightbox');
    if (!dlg) return;
    const img = qs('#lightbox-img');
    const caption = qs('#lightbox-caption');
    const images = qsa('img', root).filter((el) => !el.closest('a'));
    if (!images.length) return;
    let at = 0;

    const show = (index) => {
        at = (index + images.length) % images.length;
        const source = images[at];
        img.src = source.currentSrc || source.src;
        img.alt = source.alt || '';
        caption.textContent = source.alt || decodeURIComponent((source.src || '').split('/').pop());
    };

    // the zoom is advertised with cursor: zoom-in, which only a pointer ever
    // sees, so the image has to carry the role and the key handling itself
    images.forEach((source, index) => {
        const open = () => {
            show(index);
            dlg.showModal();
        };
        source.tabIndex = 0;
        source.setAttribute('role', 'button');
        source.setAttribute('aria-label', 'Open image full size' + (source.alt ? ': ' + source.alt : ''));
        source.addEventListener('click', open);
        source.addEventListener('keydown', (event) => {
            if (event.key !== 'Enter' && event.key !== ' ') return;
            event.preventDefault();
            open();
        });
    });

    qs('[data-lightbox-close]', dlg).addEventListener('click', () => dlg.close());
    dlg.addEventListener('click', (event) => {
        if (event.target === dlg) dlg.close();
    });
    dlg.addEventListener('keydown', (event) => {
        if (event.key === 'ArrowRight') show(at + 1);
        if (event.key === 'ArrowLeft') show(at - 1);
    });
    dlg.addEventListener('close', () => {
        img.removeAttribute('src');
    });
}

/* --- outline ------------------------------------------------------------ */

function initToc() {
    const rail = qs('#toc-rail');
    if (!rail) return;
    const pill = qs('[data-toc-toggle]');
    // the rail is a plain column on a wide screen, and a sheet over the page only
    // where the pill is on screen. Only then does it own the focus, and the flag
    // keeps the inert it sets from being lifted by anything else that closes.
    const isSheet = () => !!pill && pill.offsetParent !== null;
    let sheetOpen = false;
    let lastFocused = null;

    const setOpen = (open) => {
        document.body.classList.toggle('toc-open', open);
        if (pill) pill.setAttribute('aria-expanded', String(open));

        const asSheet = open && isSheet();
        if (asSheet === sheetOpen) return;
        sheetOpen = asSheet;

        qsa('.topbar, .main, .sidebar').forEach((el) => {
            if (asSheet) {
                el.setAttribute('inert', '');
            } else {
                el.removeAttribute('inert');
            }
        });
        if (asSheet) {
            rail.setAttribute('role', 'dialog');
            rail.setAttribute('aria-modal', 'true');
            lastFocused = document.activeElement;
            const first = qs('.toc-list a', rail) || qs('[data-toc-close]', rail);
            if (first) first.focus();
            return;
        }
        rail.removeAttribute('role');
        rail.removeAttribute('aria-modal');
        if (lastFocused && lastFocused.isConnected) lastFocused.focus();
    };
    if (pill) pill.addEventListener('click', () => setOpen(!document.body.classList.contains('toc-open')));
    qsa('[data-toc-close]').forEach((b) => b.addEventListener('click', () => {
        setOpen(false);
        if (pill) pill.focus();
    }));
    rail.addEventListener('click', (event) => {
        if (event.target.closest('a')) setOpen(false);
    });
    document.addEventListener('click', (event) => {
        if (!document.body.classList.contains('toc-open')) return;
        if (rail.contains(event.target) || (pill && pill.contains(event.target))) return;
        setOpen(false);
    });

    const links = qsa('.toc-item a', rail);
    if (!links.length) return;
    const byId = new Map();
    links.forEach((link) => {
        // the renderer percent encodes Cyrillic fragments, decode before lookup
        const id = decodeURIComponent(link.getAttribute('href').slice(1));
        byId.set(id, link.parentElement);
    });

    const targets = Array.from(byId.keys())
        .map((id) => document.getElementById(id))
        .filter(Boolean);
    if (!targets.length || !('IntersectionObserver' in window)) return;

    const seen = new Set();
    const mark = () => {
        // at the top of the page the first heading is usually still below the
        // observer's band, which would leave the outline blank until a scroll
        const active = targets.find((target) => seen.has(target.id)) ||
            (window.scrollY < 4 ? targets[0] : null);
        if (!active) return;
        links.forEach((link) => link.parentElement.classList.remove('is-active'));
        const item = byId.get(active.id);
        if (!item) return;
        item.classList.add('is-active');
        if (rail.scrollHeight > rail.clientHeight) {
            rail.scrollTo({top: item.offsetTop - rail.clientHeight / 2, behavior: 'auto'});
        }
    };

    const observer = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
            if (entry.isIntersecting) {
                seen.add(entry.target.id);
            } else {
                seen.delete(entry.target.id);
            }
        });
        mark();
    }, {rootMargin: '-' + (document.querySelector('.topbar') || {offsetHeight: 52}).offsetHeight + 'px 0px -70% 0px'});

    targets.forEach((target) => observer.observe(target));
}

/* --- jumping to the match a search result pointed at --------------------- */

// the terms come from the ?q= a search result carried over. Quotes only group a
// phrase for the index, so they are dropped before matching text on the page.
function queryTerms() {
    const raw = new URLSearchParams(location.search).get('q') || '';
    return raw.replace(/["']/g, ' ').split(/\s+/).filter((term) => term.length > 1);
}

// katex and mermaid own their subtrees: a mark spliced into one corrupts the
// rendering, and neither holds prose worth jumping to. .math is the source
// katex has not typeset yet, and typesetting it detaches any mark placed there,
// leaving the find bar counting hits that no longer exist.
const FIND_SKIP = 'script, style, svg, .katex, .math, .mermaid, .code-copy, .anchor';

function escapeRegExp(text) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function markMatches(root, terms) {
    const pattern = new RegExp('(' + terms.map(escapeRegExp).join('|') + ')', 'gi');
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
        acceptNode: (node) => (node.nodeValue.trim() && !node.parentElement.closest(FIND_SKIP)
            ? NodeFilter.FILTER_ACCEPT
            : NodeFilter.FILTER_REJECT)
    });
    const texts = [];
    for (let node = walker.nextNode(); node; node = walker.nextNode()) texts.push(node);

    const hits = [];
    texts.forEach((node) => {
        const value = node.nodeValue;
        pattern.lastIndex = 0;
        if (!pattern.test(value)) return;
        pattern.lastIndex = 0;
        const frag = document.createDocumentFragment();
        let last = 0;
        for (let found = pattern.exec(value); found; found = pattern.exec(value)) {
            frag.appendChild(document.createTextNode(value.slice(last, found.index)));
            const mark = document.createElement('mark');
            mark.className = 'find-hit';
            mark.textContent = found[0];
            frag.appendChild(mark);
            hits.push(mark);
            last = found.index + found[0].length;
        }
        frag.appendChild(document.createTextNode(value.slice(last)));
        node.parentNode.replaceChild(frag, node);
    });
    return hits;
}

function initFindOnPage(root) {
    const terms = queryTerms();
    if (!terms.length) return;
    const hits = markMatches(root, terms);
    if (!hits.length) return;

    let at = 0;
    const bar = document.createElement('div');
    bar.className = 'find-bar';
    bar.setAttribute('role', 'status');
    bar.innerHTML = '<span class="find-count"></span>' +
        '<button class="icon-btn" type="button" data-find-prev aria-label="Previous match">' +
        '<svg class="icon" aria-hidden="true"><use href="#icon-chevron"></use></svg></button>' +
        '<button class="icon-btn" type="button" data-find-next aria-label="Next match">' +
        '<svg class="icon" aria-hidden="true"><use href="#icon-chevron"></use></svg></button>' +
        '<button class="icon-btn" type="button" data-find-close aria-label="Clear highlighting">' +
        '<svg class="icon" aria-hidden="true"><use href="#icon-close"></use></svg></button>';
    document.body.appendChild(bar);
    const count = qs('.find-count', bar);

    const show = (index, behavior) => {
        at = (index + hits.length) % hits.length;
        hits.forEach((mark, i) => mark.classList.toggle('is-active', i === at));
        count.textContent = (at + 1) + ' of ' + hits.length;
        hits[at].scrollIntoView({block: 'center', behavior});
    };

    const clear = () => {
        bar.remove();
        hits.forEach((mark) => mark.parentNode.replaceChild(
            document.createTextNode(mark.textContent), mark));
        // the query leaves the url with it, so a reload does not light it up again
        history.replaceState(null, '', location.pathname + location.hash);
    };

    qs('[data-find-prev]', bar).addEventListener('click', () => show(at - 1, 'smooth'));
    qs('[data-find-next]', bar).addEventListener('click', () => show(at + 1, 'smooth'));
    qs('[data-find-close]', bar).addEventListener('click', clear);
    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && bar.isConnected) clear();
    });
    // instant on arrival: the reader asked to be taken there, and animating the
    // whole page down to the match only delays it
    show(0, 'auto');
}

export function initReader() {
    const root = qs('#doc');
    if (root) {
        enhanceCode(root);
        enhanceHeadings(root);
        initLightbox(root);
        initMath(root);
        initDiagrams(root);
        initFindOnPage(root);
    }
    initToc();

    qsa('[data-back-to-top]').forEach((link) => link.addEventListener('click', (event) => {
        event.preventDefault();
        window.scrollTo({top: 0, behavior: 'smooth'});
        const main = qs('#main');
        if (main) main.focus();
    }));
}
