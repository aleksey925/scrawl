// entry point: every feature is optional, a page only gets what it has markup
// for, so the server rendered HTML stays usable on its own

import {initTheme} from './theme.js';
import {initNav} from './nav.js';
import {initPalette} from './palette.js';
import {initReader} from './reader.js';
import {initEditor} from './editor.js';
import {initHistory} from './history.js';
import {initShortcuts} from './shortcuts.js';
import {rememberRev, revSeen} from './dom.js';

// what the on-screen keyboard leaves visible. Any page can put a full height
// sheet over itself, the palette included, so this is global rather than the
// editor's own business.
function trackViewport() {
    const vv = window.visualViewport;
    if (!vv) return;
    const sync = () => {
        // visualViewport.height is the layout height divided by the zoom, so
        // syncing while pinched in shrinks a full height panel to a fraction of
        // the screen and leaves the rest of it blank
        if (vv.scale > 1.01) return;
        document.documentElement.style.setProperty('--vvh', vv.height + 'px');
        // a keyboard is the only thing that takes this much of the screen and
        // gives it back. Anything centred in the viewport has to move up while
        // it is there, and css cannot ask the question itself.
        document.documentElement.classList.toggle(
            'keyboard-up', vv.height < window.innerHeight - 120);
    };
    vv.addEventListener('resize', sync);
    vv.addEventListener('scroll', sync);
    sync();
}

// pageshow fires on a normal load as well as on a back-forward restore, so the
// same handler records the revision the server just rendered and, on a restore,
// compares it with the one the editor wrote
function watchRestore() {
    window.addEventListener('pageshow', (event) => {
        const doc = document.querySelector('#doc[data-path][data-rev]');
        if (!doc) return;
        if (!event.persisted) {
            rememberRev(doc.dataset.path, doc.dataset.rev);
            return;
        }
        const seen = revSeen(doc.dataset.path);
        if (seen && seen !== doc.dataset.rev) location.reload();
    });
}

function boot() {
    // one at a time, and a failure never reaches the next: note content is
    // rendered before the app chrome and may carry an id the app looks up
    // itself, so a lookup that comes back null has to cost that one feature
    // rather than every feature after it
    for (const init of [trackViewport, watchRestore, initTheme, initNav, initPalette,
        initReader, initEditor, initHistory, initShortcuts]) {
        try {
            init();
        } catch (err) {
            console.error('scrawl: ' + init.name + ' did not start', err);
        }
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
} else {
    boot();
}
