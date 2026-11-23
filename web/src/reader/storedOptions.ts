import { localStore, readJson, writeJson } from '../storage';

import type { FindOptions } from './findOptions';

export function storedOptions<T extends FindOptions>(key: string, defaults: T): T {
  return { ...defaults, ...readJson<Partial<T>>(localStore(), key) };
}

export function storeOptions(key: string, options: FindOptions): void {
  writeJson(localStore(), key, options);
}
