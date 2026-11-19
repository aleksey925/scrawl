import { pathAfterMove } from '../shell/naming';
import { keysWithPrefix, localStore, readText, removeKey, writeText } from '../storage';

import { draftPrefix } from './constants';

export function draftKey(scope: string, path: string): string {
  return `${draftPrefix}${scope}:${path}`;
}

export function moveDrafts(scope: string, from: string, to: string): void {
  const store = localStore();
  const prefix = draftKey(scope, '');
  for (const key of keysWithPrefix(store, prefix)) {
    const moved = pathAfterMove(key.slice(prefix.length), from, to);
    const text = readText(store, key);
    if (moved === undefined || text === undefined) {
      continue;
    }
    if (writeText(store, draftKey(scope, moved), text)) {
      removeKey(store, key);
    }
  }
}
