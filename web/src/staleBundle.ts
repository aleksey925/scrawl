import { readJson, sessionStore, writeJson } from './storage';

const reloadedAtKey = 'scrawl-stale-bundle-reload';

// a chunk that keeps failing within this time is shown as the error it is
const reloadIntervalMs = 60_000;

let reloading = false;

let recover: () => boolean = () => false;

// leavingIsGuarded asks the page's beforeunload listeners, the editor's guard
// among them, whether leaving now would bring up the browser's prompt: a reload
// that prompt refuses leaves no trace a page can read
function leavingIsGuarded(): boolean {
  const probe = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(probe);
  return probe.defaultPrevented;
}

// reloadOnStaleBundle loads the page again when a chunk fails to load. The
// server answers the bundle of its own release only, so a page left open
// across an upgrade asks for chunks that are gone, and a reload brings the
// new release. The router moves the address only once a route's chunk is in,
// so the load goes to pending(), the address a click was on its way to.
// Once a minute at most, so a chunk gone for another reason shows its error
// rather than reloading forever, and never over unsaved changes.
export function reloadOnStaleBundle(pending: () => string | undefined): void {
  const store = sessionStore();
  // with no storage the last reload is gone with the page it left, so the
  // load of this page stands in for it, and a reload cannot loop
  let lastReload = store === undefined ? Date.now() : 0;
  recover = () => {
    if (reloading) {
      return true;
    }
    const last = readJson<number>(store, reloadedAtKey) ?? lastReload;
    if (Date.now() - last < reloadIntervalMs || leavingIsGuarded()) {
      return false;
    }
    lastReload = Date.now();
    writeJson(store, reloadedAtKey, lastReload);
    reloading = true;
    const href = pending();
    if (href === undefined) {
      window.location.reload();
    } else {
      window.location.assign(href);
    }
    return true;
  };
  window.addEventListener('vite:preloadError', (event) => {
    if (reloadForStaleBundle()) {
      event.preventDefault();
    }
  });
}

// reloadForStaleBundle starts the reload for a file of the bundle that failed
// to load and says whether the page is reloading
export function reloadForStaleBundle(): boolean {
  return recover();
}

// loadChunk is a dynamic import that never settles once the page is reloading
// for a stale bundle: vite answers the failed import with undefined then, and
// a route or the formatter would show that as an error the reload replaces
export function loadChunk<T>(load: Promise<T>): Promise<T> {
  const never = (): Promise<T> => new Promise<T>(() => undefined);
  return load.then(
    (module) => (reloading ? never() : module),
    (error: unknown) => {
      if (reloading) {
        return never();
      }
      throw error;
    },
  );
}
