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

    function syncTouchIcon(choice) {
        var links = document.querySelectorAll('link[rel="apple-touch-icon"]');
        if (links.length === 0) {
            return;
        }
        var base = links[0].getAttribute('href');
        for (var i = 0; i < links.length; i += 1) {
            links[i].remove();
        }
        var theme = find(choice);
        var wanted = theme ? [[theme.scheme, '']] : [['light', '(prefers-color-scheme: light)'], ['dark', '(prefers-color-scheme: dark)']];
        for (var k = 0; k < wanted.length; k += 1) {
            var link = document.createElement('link');
            link.rel = 'apple-touch-icon';
            link.href = base.replace(/apple-touch-icon(?:-dark)?\.png/, wanted[k][0] === 'dark' ? 'apple-touch-icon-dark.png' : 'apple-touch-icon.png');
            if (wanted[k][1]) {
                link.media = wanted[k][1];
            }
            document.head.appendChild(link);
        }
    }

    try {
        var stored = document.cookie.match(/(?:^|;\s*)theme=([a-z0-9-]+)/);
        if (stored && ORDER.indexOf(stored[1]) !== -1) {
            apply(stored[1]);
        }
    } catch (e) {
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
            syncTouchIcon(next);
        });

        window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function () {
            if (current() === 'auto') {
                syncBarColor('auto');
            }
        });
    });
})();
