// The sign-in page's own theme toggle. It is a separate file rather than an
// inline block because script-src is 'self' with no nonce, and it is render
// blocking so the stored choice is on the root element before the first paint.
(function () {
    var ATTR = 'data-scrawl-theme';
    var root = document.documentElement;
    var list = document.querySelector('meta[name="scrawl-themes"]');
    var THEMES = list ? JSON.parse(list.content) : [];
    var ORDER = ['auto'].concat(THEMES.map(function (theme) {
        return theme.id;
    }));

    function find(id) {
        for (var i = 0; i < THEMES.length; i += 1) {
            if (THEMES[i].id === id) {
                return THEMES[i];
            }
        }
        return null;
    }

    function current() {
        return find(root.getAttribute(ATTR)) ? root.getAttribute(ATTR) : 'auto';
    }

    function apply(choice) {
        if (find(choice)) {
            root.setAttribute(ATTR, choice);
        } else {
            root.removeAttribute(ATTR);
        }
    }

    function showChoice(button, choice) {
        var theme = find(choice);
        button.setAttribute('aria-label', 'Theme: ' + (theme ? theme.name : 'system'));
        button.setAttribute('data-icon', theme ? theme.scheme : 'auto');
    }

    // the head ships metas for the theme the server rendered, which is the wrong
    // bar colour once the toggle or the stored cookie picked another one
    function syncBarColor(choice) {
        var theme = find(choice) ||
            find(window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
        var metas = document.querySelectorAll('meta[name="theme-color"]');
        for (var i = 0; i < metas.length; i += 1) {
            metas[i].remove();
        }
        if (!theme) {
            return;
        }
        var meta = document.createElement('meta');
        meta.name = 'theme-color';
        meta.content = theme.bar;
        document.head.appendChild(meta);
    }

    try {
        var stored = document.cookie.match(/(?:^|;\s*)theme=([a-z0-9-]+)/);
        if (stored && ORDER.indexOf(stored[1]) !== -1) {
            apply(stored[1]);
        }
    } catch (e) {
        // cookies disabled, keep whatever the server rendered
    }

    document.addEventListener('DOMContentLoaded', function () {
        var button = document.querySelector('[data-theme-toggle]');
        if (!button) {
            return;
        }
        showChoice(button, current());
        syncBarColor(current());

        button.addEventListener('click', function () {
            var next = ORDER[(ORDER.indexOf(current()) + 1) % ORDER.length];
            apply(next);
            document.cookie = 'theme=' + next + ';path=/;max-age=31536000;samesite=lax';
            showChoice(button, next);
            syncBarColor(next);
        });

        window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function () {
            if (current() === 'auto') {
                syncBarColor('auto');
            }
        });
    });
})();
