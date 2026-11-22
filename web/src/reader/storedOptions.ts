import { localStore, readJson, writeJson } from '../storage';

import type { FindOptions } from './findOptions';

export function storedOptions<T extends FindOptions>(key: string, defaults: T): T {
  const stored: Partial<Record<keyof T, unknown>> = readJson(localStore(), key) ?? {};
  const options = { ...defaults };
  for (const name of Object.keys(defaults) as (keyof T)[]) {
    const value = stored[name];
    if (typeof value === 'boolean') {
      options[name] = value as T[keyof T];
    }
  }
  return options.fuzzy && options.regex ? { ...options, regex: false } : options;
}

export function storeOptions<T extends FindOptions>(key: string, options: T): void {
  writeJson(localStore(), key, options);
}
