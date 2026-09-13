// on demand loading for the two vendored libraries. Nothing here runs unless a
// document actually holds math or a diagram, so a plain page never pays for
// katex or mermaid.

const pending = new Map();

function once(key, make) {
    if (!pending.has(key)) {
        // the rejection is dropped from the map, otherwise one flaky request
        // turns into "could not load" on every page for the rest of the session
        pending.set(key, new Promise(make).catch((err) => {
            pending.delete(key);
            throw err;
        }));
    }
    return pending.get(key);
}

// assetURL resolves a path next to the js folder, which keeps the cache busting
// version segment the server put in front of it
export function assetURL(path) {
    return new URL(path, import.meta.url).href;
}

export function loadScript(url) {
    return once('js:' + url, (resolve, reject) => {
        const el = document.createElement('script');
        el.src = url;
        el.addEventListener('load', () => resolve());
        el.addEventListener('error', () => reject(new Error('cannot load ' + url)));
        document.head.appendChild(el);
    });
}

export function loadStyle(url) {
    return once('css:' + url, (resolve, reject) => {
        const el = document.createElement('link');
        el.rel = 'stylesheet';
        el.href = url;
        el.addEventListener('load', () => resolve());
        el.addEventListener('error', () => reject(new Error('cannot load ' + url)));
        document.head.appendChild(el);
    });
}
