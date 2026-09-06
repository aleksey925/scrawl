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
            button.innerHTML = '<svg class="icon" aria-hidden="true"><use href="#icon-check"></use></svg>';
            setTimeout(() => {
                button.classList.remove('is-done');
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
        heading.appendChild(link);
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

    images.forEach((source, index) => {
        source.addEventListener('click', () => {
            show(index);
            dlg.showModal();
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
    const setOpen = (open) => {
        document.body.classList.toggle('toc-open', open);
        if (pill) pill.setAttribute('aria-expanded', String(open));
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
        const active = targets.find((target) => seen.has(target.id));
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

export function initReader() {
    const root = qs('#doc');
    if (root) {
        enhanceCode(root);
        enhanceHeadings(root);
        initLightbox(root);
        initMath(root);
        initDiagrams(root);
    }
    initToc();

    qsa('[data-back-to-top]').forEach((link) => link.addEventListener('click', (event) => {
        event.preventDefault();
        window.scrollTo({top: 0, behavior: 'smooth'});
        const main = qs('#main');
        if (main) main.focus();
    }));
}
