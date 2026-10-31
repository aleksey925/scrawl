import { readJson, sessionStore, writeJson } from './storage';

const reloadedAtKey = 'scrawl-stale-bundle-reload';

const reloadIntervalMs = 60_000;

let reloading = false;

let recover: () => boolean = () => false;

function leavingIsGuarded(): boolean {
  const probe = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(probe);
  return probe.defaultPrevented;
}

export function reloadOnStaleBundle(pending: () => string | undefined): void {
  const store = sessionStore();
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

export function reloadForStaleBundle(): boolean {
  return recover();
}

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
