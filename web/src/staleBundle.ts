import { readJson, sessionStore, writeJson } from './storage';

const reloadedAtKey = 'scrawl-stale-bundle-reload';

const reloadIntervalMs = 60_000;

let reloading = false;

let quietLoads = 0;

const failedQuietly = new Set<() => Promise<unknown>>();

let recover: () => boolean = () => false;

const holds = new Set<() => boolean>();

export function holdReload(held: () => boolean): () => void {
  holds.add(held);
  return () => {
    holds.delete(held);
  };
}

function reloadIsHeld(): boolean {
  return [...holds].some((check) => check());
}

export function reloadOnStaleBundle(pending: () => string | undefined): void {
  const store = sessionStore();
  let lastReload = store === undefined ? Date.now() : 0;
  recover = () => {
    if (reloading) {
      return true;
    }
    const last = readJson<number>(store, reloadedAtKey) ?? lastReload;
    if (Date.now() - last < reloadIntervalMs || reloadIsHeld()) {
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
    if (quietLoads > 0) {
      return;
    }
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
      if (reloadForStaleBundle()) {
        return never();
      }
      throw error;
    },
  );
}

export function loadQuietly(load: () => Promise<unknown>): void {
  quietLoads += 1;
  void load()
    .catch(() => {
      failedQuietly.add(load);
    })
    .finally(() => {
      quietLoads -= 1;
    });
}

export function reloadIfFailedQuietly(load: () => Promise<unknown>): boolean {
  return failedQuietly.has(load) && !reloadForStaleBundle();
}
