import { localStore, readJson, writeJson } from '../storage';

import type { FindOptions } from './findOptions';

export function storedOptions<T extends FindOptions>(key: string, defaults: T): T {
  return { ...defaults, ...readJson<Partial<T>>(localStore(), key) };
}

export function storeOptions<T extends FindOptions>(key: string, options: T): void {
  writeJson(localStore(), key, options);
}
