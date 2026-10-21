import { useSyncExternalStore } from 'react';

import { changeSignal } from '../changeSignal';
import { localStore, readText, writeText } from '../storage';
import { readCookie, writeCookie } from '../themePersistence';

// PageWidth is how wide a note is read: Notion's 720px column, a wider one,
// or the whole room beside the sidebar. One value holds for every note.
export const pageWidths = ['normal', 'wide', 'full'] as const;

export type PageWidth = (typeof pageWidths)[number];

const defaultWidth: PageWidth = 'normal';

// the attribute on the root element the stylesheets read the width from
export const pageWidthAttribute = 'data-page-width';

export function isPageWidth(value: string): value is PageWidth {
  return (pageWidths as readonly string[]).includes(value);
}

interface WidthPersistence {
  read: () => string | undefined;
  write: (width: PageWidth) => void;
}

const storageKey = 'scrawl.page.width';

// the app keeps the choice in the browser: it is one reader's taste, and the
// server has nothing to paint from it
function browserPersistence(): WidthPersistence {
  return {
    read: () => readText(localStore(), storageKey),
    write: (width) => writeText(localStore(), storageKey, width),
  };
}

// a site keeps it the way it keeps the theme, twice: from disk Firefox shares
// only the cookie between its pages and Chromium only the storage
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

// keepPageWidthIn picks where the choice is kept, before the first render
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

// applyStoredPageWidth puts the page at the kept width before the first paint
export function applyStoredPageWidth(): void {
  apply(width());
}

// restorePageWidth reads the kept width again, for a page the browser brings
// back as it was left after another page changed the choice
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
