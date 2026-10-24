import { readJson, sessionStore, writeJson } from './storage';

const reloadedAtKey = 'scrawl-stale-bundle-reload';

// a chunk that keeps failing within this time is shown as the error it is
const reloadInterval = 60_000;

// reloadOnStaleBundle loads the page again when a chunk fails to load. The
// server answers the bundle of its own release only, so a page left open
// across an upgrade asks for chunks that are gone, and a reload brings the
// new release. The router moves the address only once a route's chunk is in,
// so the load goes to pending(), the address a click was on its way to.
// Once a minute at most, so a chunk gone for another reason shows its error
// rather than reloading forever.
export function reloadOnStaleBundle(pending: () => string | undefined): void {
  window.addEventListener('vite:preloadError', (event) => {
    const store = sessionStore();
    const last = readJson<number>(store, reloadedAtKey) ?? 0;
    if (store === undefined || Date.now() - last < reloadInterval) {
      return;
    }
    writeJson(store, reloadedAtKey, Date.now());
    event.preventDefault();
    const href = pending();
    if (href === undefined) {
      window.location.reload();
    } else {
      window.location.assign(href);
    }
  });
}
