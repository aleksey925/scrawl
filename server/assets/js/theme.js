// theme toggle: cycles system -> light -> dark and stores the choice in the
// theme cookie so the server can render the right theme with no flash

import {qsa} from './dom.js';

const ORDER = ['auto', 'light', 'dark'];
const LABEL = {auto: 'Theme: system', light: 'Theme: light', dark: 'Theme: dark'};
const BAR = {light: '#ffffff', dark: '#1c1c1e'};

function current() {
    const value = document.documentElement.getAttribute('data-theme');
    return ORDER.includes(value) ? value : 'auto';
}

function apply(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    document.cookie = 'theme=' + theme + ';path=/;max-age=31536000;samesite=lax';
    qsa('[data-theme-toggle]').forEach((btn) => btn.setAttribute('aria-label', LABEL[theme]));
    syncBarColor(theme);
}

function syncBarColor(theme) {
    const dark = theme === 'dark' ||
        (theme === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    qsa('meta[name="theme-color"]').forEach((meta) => meta.remove());
    const meta = document.createElement('meta');
    meta.name = 'theme-color';
    meta.content = dark ? BAR.dark : BAR.light;
    document.head.appendChild(meta);
}

export function initTheme() {
    const buttons = qsa('[data-theme-toggle]');
    if (!buttons.length) return;
    buttons.forEach((btn) => btn.setAttribute('aria-label', LABEL[current()]));
    buttons.forEach((btn) => btn.addEventListener('click', () => {
        apply(ORDER[(ORDER.indexOf(current()) + 1) % ORDER.length]);
    }));
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
        if (current() === 'auto') syncBarColor('auto');
    });
}
