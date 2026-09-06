// runs before first paint, kept out of the module graph and out of an inline
// <script> so the page needs no script-src nonce
(function () {
    document.documentElement.classList.add('js');
    try {
        var m = document.cookie.match(/(?:^|;\s*)theme=(light|dark|auto)/);
        if (m) {
            document.documentElement.setAttribute('data-theme', m[1]);
        }
    } catch (e) {
        // cookies disabled, keep whatever the server rendered
    }
})();
