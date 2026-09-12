// entry point: every feature is optional, a page only gets what it has markup
// for, so the server rendered HTML stays usable on its own

import {initTheme} from './theme.js';
import {initNav} from './nav.js';
import {initPalette} from './palette.js';
import {initReader} from './reader.js';
import {initEditor} from './editor.js';
import {initHistory} from './history.js';
import {initShortcuts} from './shortcuts.js';

function boot() {
    // one at a time, and a failure never reaches the next: note content is
    // rendered before the app chrome and may carry an id the app looks up
    // itself, so a lookup that comes back null has to cost that one feature
    // rather than every feature after it
    for (const init of [initTheme, initNav, initPalette, initReader, initEditor, initHistory, initShortcuts]) {
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
