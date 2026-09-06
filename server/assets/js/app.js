// entry point: every feature is optional, a page only gets what it has markup
// for, so the server rendered HTML stays usable on its own

import {initTheme} from './theme.js';
import {initNav} from './nav.js';
import {initPalette} from './palette.js';
import {initReader} from './reader.js';
import {initEditor} from './editor.js';
import {initShortcuts} from './shortcuts.js';

function boot() {
    initTheme();
    initNav();
    initPalette();
    initReader();
    initEditor();
    initShortcuts();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
} else {
    boot();
}
