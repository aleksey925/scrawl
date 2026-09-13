import type { MantineColorScheme, MantineColorSchemeManager } from '@mantine/core';

// the go server renders the first byte from this cookie, so the choice cannot
// live in localStorage: the server would have no way to read it
const cookieName = 'theme';
const cookieMaxAge = 60 * 60 * 24 * 365;
const colorSchemeAttribute = 'data-mantine-color-scheme';

export const colorSchemeCycle: readonly MantineColorScheme[] = ['auto', 'light', 'dark'];

export function isColorScheme(value: string): value is MantineColorScheme {
  return value === 'light' || value === 'dark' || value === 'auto';
}

export function readColorSchemeCookie(): MantineColorScheme | undefined {
  for (const part of document.cookie.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name !== cookieName) {
      continue;
    }
    const value = decodeURIComponent(rest.join('='));
    return isColorScheme(value) ? value : undefined;
  }
  return undefined;
}

function writeColorSchemeCookie(value: MantineColorScheme): void {
  const secure = window.location.protocol === 'https:' ? '; secure' : '';
  document.cookie = `${cookieName}=${value}; path=/; max-age=${cookieMaxAge}; samesite=lax${secure}`;
}

export function nextColorScheme(current: MantineColorScheme): MantineColorScheme {
  const index = colorSchemeCycle.indexOf(current);
  return colorSchemeCycle[(index + 1) % colorSchemeCycle.length] ?? 'auto';
}

export function systemColorScheme(): 'light' | 'dark' {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function cookieColorSchemeManager(): MantineColorSchemeManager {
  return {
    get: (defaultValue) => readColorSchemeCookie() ?? defaultValue,
    set: (value) => writeColorSchemeCookie(value),
    // the platform fires no event when a cookie changes, so there is nothing
    // to subscribe to; a second tab picks the choice up on its next load
    subscribe: () => {},
    unsubscribe: () => {},
    clear: () => {
      document.cookie = `${cookieName}=; path=/; max-age=0; samesite=lax`;
    },
  };
}

export function serverColorScheme(): 'light' | 'dark' | undefined {
  const value = document.documentElement.getAttribute(colorSchemeAttribute);
  return value === 'light' || value === 'dark' ? value : undefined;
}

// stands in for Mantine's ColorSchemeScript, which the content security policy
// forbids: it is an inline script and script-src carries no nonce. The server
// shell already resolves the attribute, so this only covers the dev server.
export function applyStoredColorScheme(): void {
  if (serverColorScheme() !== undefined) {
    return;
  }
  const stored = readColorSchemeCookie() ?? 'auto';
  document.documentElement.setAttribute(
    colorSchemeAttribute,
    stored === 'auto' ? systemColorScheme() : stored,
  );
}
