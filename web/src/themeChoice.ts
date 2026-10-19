import type { MantineColorScheme, MantineColorSchemeManager } from '@mantine/core';
import { useSyncExternalStore } from 'react';

import { serverPersistence, type ThemePersistence } from './themePersistence';
import { applyChoiceAttributes, applyThemeAttribute, autoChoice, colorSchemeAttribute, lookupTheme } from './themes';

let persistence = serverPersistence();
let current: string | undefined;

// keepThemeIn picks where the choice is kept. An entry calls it before the
// first render, which is the first time the choice is read.
export function keepThemeIn(where: ThemePersistence): void {
  persistence = where;
  current = undefined;
}

function choice(): string {
  current ??= persistence.read() ?? autoChoice;
  return current;
}

// schemeOf is the mantine color scheme a choice puts the page in
function schemeOf(picked: string): MantineColorScheme {
  return lookupTheme(picked)?.scheme ?? autoChoice;
}

// mantine keeps a scheme and not a theme, and two themes can share one, so its
// manager only reads the scheme of the choice. Writing is setThemeChoice's.
export function themeColorSchemeManager(): MantineColorSchemeManager {
  return {
    get: (defaultValue) => {
      const picked = persistence.read();
      return picked === undefined ? defaultValue : schemeOf(picked);
    },
    set: () => {},
    // the platform fires no event when a cookie changes, so there is nothing
    // to subscribe to; a second tab picks the choice up on its next load
    subscribe: () => {},
    unsubscribe: () => {},
    clear: () => persistence.clear(),
  };
}

const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// useThemeChoice is the theme the reader picked, or auto
export function useThemeChoice(): string {
  return useSyncExternalStore(subscribe, choice);
}

function show(picked: string, setColorScheme: (value: MantineColorScheme) => void): void {
  current = picked;
  applyThemeAttribute(picked);
  setColorScheme(schemeOf(picked));
  for (const listener of listeners) {
    listener();
  }
}

// setThemeChoice moves the page to another theme. The stylesheets key on the
// attribute and mantine on its scheme, so nothing reloads
export function setThemeChoice(picked: string, setColorScheme: (value: MantineColorScheme) => void): void {
  persistence.write(picked);
  show(picked, setColorScheme);
}

// previewThemeChoice shows a theme without keeping it, for a print the page is
// put back from with restoreThemeChoice
export function previewThemeChoice(picked: string, setColorScheme: (value: MantineColorScheme) => void): void {
  show(picked, setColorScheme);
}

// restoreThemeChoice puts the page back on the choice that is kept, for a page
// the browser brings back as it was left after another page changed the choice
export function restoreThemeChoice(setColorScheme: (value: MantineColorScheme) => void): void {
  show(persistence.read() ?? autoChoice, setColorScheme);
}

// stands in for Mantine's ColorSchemeScript, which the content security policy
// forbids: it is an inline script and script-src carries no nonce. The server
// shell already sets both attributes for a theme it was told, so this covers
// auto and the dev server.
export function applyStoredTheme(): void {
  if (document.documentElement.hasAttribute(colorSchemeAttribute)) {
    return;
  }
  applyChoiceAttributes(choice());
}
