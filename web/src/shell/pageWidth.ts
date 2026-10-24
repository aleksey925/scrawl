import { useSyncExternalStore } from 'react';

import { changeSignal } from '../changeSignal';
import { localStore, readText, writeText } from '../storage';
import { readCookie, writeCookie } from '../themePersistence';

export const pageWidths = ['normal', 'wide', 'full'] as const;

export type PageWidth = (typeof pageWidths)[number];

const defaultWidth: PageWidth = 'normal';

export const pageWidthAttribute = 'data-page-width';

export function isPageWidth(value: string): value is PageWidth {
  return (pageWidths as readonly string[]).includes(value);
}

interface WidthPersistence {
  read: () => string | undefined;
  write: (width: PageWidth) => void;
}

const storageKey = 'scrawl.page.width';

function browserPersistence(): WidthPersistence {
  return {
    read: () => readText(localStore(), storageKey),
    write: (width) => writeText(localStore(), storageKey, width),
  };
}

export function sitePersistence(): WidthPersistence {
  const cookie = 'scrawl-page-width';
  return {
    read: () => readCookie(cookie, isPageWidth) ?? readText(localStore(), storageKey),
    write: (width) => {
      writeCookie(cookie, width, false);
      writeText(localStore(), storageKey, width);
    },
  };
}

let persistence = browserPersistence();
let current: PageWidth | undefined;
const changes = changeSignal();

export function keepPageWidthIn(where: WidthPersistence): void {
  persistence = where;
  current = undefined;
}

function width(): PageWidth {
  if (current === undefined) {
    const stored = persistence.read();
    current = stored !== undefined && isPageWidth(stored) ? stored : defaultWidth;
  }
  return current;
}

function apply(picked: PageWidth): void {
  document.documentElement.setAttribute(pageWidthAttribute, picked);
}

export function applyStoredPageWidth(): void {
  apply(width());
}

export function restorePageWidth(): void {
  current = undefined;
  apply(width());
  changes.notify();
}

export function setPageWidth(picked: PageWidth): void {
  current = picked;
  persistence.write(picked);
  apply(picked);
  changes.notify();
}

export function usePageWidth(): PageWidth {
  return useSyncExternalStore(changes.subscribe, width);
}
