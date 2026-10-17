import type { MantineColorScheme, MantineColorSchemeManager } from '@mantine/core';
import { useSyncExternalStore } from 'react';

import { applyThemeAttribute, autoChoice, isThemeChoice, lookupTheme } from './themes';

// the go server renders the first byte from this cookie, so the choice cannot
// live in localStorage: the server would have no way to read it
const cookieName = 'theme';
const cookieMaxAge = 60 * 60 * 24 * 365;
const colorSchemeAttribute = 'data-mantine-color-scheme';

function readThemeCookie(): string | undefined {
  for (const part of document.cookie.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name !== cookieName) {
      continue;
    }
    const value = decodeURIComponent(rest.join('='));
    return isThemeChoice(value) ? value : undefined;
  }
  return undefined;
}

function writeThemeCookie(value: string): void {
  const secure = window.location.protocol === 'https:' ? '; secure' : '';
  document.cookie = `${cookieName}=${value}; path=/; max-age=${cookieMaxAge}; samesite=lax${secure}`;
}

function systemColorScheme(): 'light' | 'dark' {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

// schemeOf is the mantine color scheme a choice puts the page in
function schemeOf(choice: string): MantineColorScheme {
  return lookupTheme(choice)?.scheme ?? autoChoice;
}

// mantine keeps a scheme and not a theme, and two themes can share one, so its
// manager only reads the scheme of the choice. Writing is setThemeChoice's.
export function cookieColorSchemeManager(): MantineColorSchemeManager {
  return {
    get: (defaultValue) => {
      const choice = readThemeCookie();
      return choice === undefined ? defaultValue : schemeOf(choice);
    },
    set: () => {},
    // the platform fires no event when a cookie changes, so there is nothing
    // to subscribe to; a second tab picks the choice up on its next load
    subscribe: () => {},
    unsubscribe: () => {},
    clear: () => {
      document.cookie = `${cookieName}=; path=/; max-age=0; samesite=lax`;
    },
  };
}

let current = readThemeCookie() ?? autoChoice;
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// useThemeChoice is the theme the reader picked, or auto
export function useThemeChoice(): string {
  return useSyncExternalStore(subscribe, () => current);
}

// setThemeChoice moves the page to another theme. The stylesheets key on the
// attribute and mantine on its scheme, so nothing reloads
export function setThemeChoice(choice: string, setColorScheme: (value: MantineColorScheme) => void): void {
  current = choice;
  writeThemeCookie(choice);
  applyThemeAttribute(choice);
  setColorScheme(schemeOf(choice));
  for (const listener of listeners) {
    listener();
  }
}

// stands in for Mantine's ColorSchemeScript, which the content security policy
// forbids: it is an inline script and script-src carries no nonce. The server
// shell already sets both attributes for a theme it was told, so this covers
// auto and the dev server.
export function applyStoredTheme(): void {
  if (document.documentElement.hasAttribute(colorSchemeAttribute)) {
    return;
  }
  applyThemeAttribute(current);
  const scheme = schemeOf(current);
  document.documentElement.setAttribute(colorSchemeAttribute, scheme === 'auto' ? systemColorScheme() : scheme);
}
