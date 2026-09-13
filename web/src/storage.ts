// reading window.localStorage throws outright in a browser set to block site
// data, so every access goes through here and a failure means "no storage"
function pick(kind: 'local' | 'session'): Storage | undefined {
  try {
    return kind === 'local' ? window.localStorage : window.sessionStorage;
  } catch {
    return undefined;
  }
}

export function localStore(): Storage | undefined {
  return pick('local');
}

export function sessionStore(): Storage | undefined {
  return pick('session');
}

export function readJson<T>(store: Storage | undefined, key: string): T | undefined {
  if (store === undefined) {
    return undefined;
  }
  try {
    const raw = store.getItem(key);
    return raw === null ? undefined : (JSON.parse(raw) as T);
  } catch {
    return undefined;
  }
}

export function writeJson(store: Storage | undefined, key: string, value: unknown): void {
  if (store === undefined) {
    return;
  }
  try {
    store.setItem(key, JSON.stringify(value));
  } catch {
    // storage full or disabled, the value simply is not kept
  }
}

export function readText(store: Storage | undefined, key: string): string | undefined {
  if (store === undefined) {
    return undefined;
  }
  try {
    return store.getItem(key) ?? undefined;
  } catch {
    return undefined;
  }
}

export function writeText(store: Storage | undefined, key: string, value: string): void {
  if (store === undefined) {
    return;
  }
  try {
    store.setItem(key, value);
  } catch {
    // nothing to do, the choice is not remembered
  }
}

export function removeKey(store: Storage | undefined, key: string): void {
  if (store === undefined) {
    return;
  }
  try {
    store.removeItem(key);
  } catch {
    // nothing to clean up
  }
}

export function keysWithPrefix(store: Storage | undefined, prefix: string): string[] {
  if (store === undefined) {
    return [];
  }
  try {
    return Object.keys(store).filter((key) => key.startsWith(prefix));
  } catch {
    return [];
  }
}
