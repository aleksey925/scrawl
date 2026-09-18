// The sign-in page's own theme toggle. It is a separate file rather than an
// inline block because script-src is 'self' with no nonce, and it is render
// blocking so the stored choice is on the root element before the first paint.
(function () {
    var ORDER = ['auto', 'light', 'dark'];
    var LABEL = {auto: 'Theme: system', light: 'Theme: light', dark: 'Theme: dark'};
    var BAR = {light: '#f7f7f5', dark: '#161618'};
    var root = document.documentElement;

    function current() {
        var value = root.getAttribute('data-theme');
        return ORDER.indexOf(value) === -1 ? 'auto' : value;
    }

    function dark(theme) {
        return theme === 'dark' ||
            (theme === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    }

    // the head ships two metas keyed on prefers-color-scheme, which is the wrong
    // bar colour for anyone whose stored choice disagrees with their system
    function syncBarColor(theme) {
        var metas = document.querySelectorAll('meta[name="theme-color"]');
        for (var i = 0; i < metas.length; i += 1) {
            metas[i].remove();
        }
        var meta = document.createElement('meta');
        meta.name = 'theme-color';
        meta.content = dark(theme) ? BAR.dark : BAR.light;
        document.head.appendChild(meta);
    }

    try {
        var stored = document.cookie.match(/(?:^|;\s*)theme=(light|dark|auto)/);
        if (stored) {
            root.setAttribute('data-theme', stored[1]);
        }
    } catch (e) {
        // cookies disabled, keep whatever the server rendered
    }

    document.addEventListener('DOMContentLoaded', function () {
        var button = document.querySelector('[data-theme-toggle]');
        if (!button) {
            return;
        }
        button.setAttribute('aria-label', LABEL[current()]);
        syncBarColor(current());

        button.addEventListener('click', function () {
            var next = ORDER[(ORDER.indexOf(current()) + 1) % ORDER.length];
            root.setAttribute('data-theme', next);
            document.cookie = 'theme=' + next + ';path=/;max-age=31536000;samesite=lax';
            button.setAttribute('aria-label', LABEL[next]);
            syncBarColor(next);
        });

        window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function () {
            if (current() === 'auto') {
                syncBarColor('auto');
            }
        });
    });
})();
