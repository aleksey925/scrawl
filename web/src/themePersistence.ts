import { localStore, readText, writeText } from './storage';
import { isThemeChoice } from './themes';

// ThemePersistence is where a theme choice is kept between pages
export interface ThemePersistence {
  read: () => string | undefined;
  write: (choice: string) => void;
  clear: () => void;
}

const cookieMaxAge = 60 * 60 * 24 * 365;

// readCookie is the value of a cookie that passes valid, or nothing
export function readCookie(name: string, valid: (value: string) => boolean): string | undefined {
  for (const part of document.cookie.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key !== name) {
      continue;
    }
    const value = decodeURIComponent(rest.join('='));
    return valid(value) ? value : undefined;
  }
  return undefined;
}

export function writeCookie(name: string, value: string, secure: boolean): void {
  const flag = secure ? '; secure' : '';
  document.cookie = `${name}=${value}; path=/; max-age=${cookieMaxAge}; samesite=lax${flag}`;
}

function clearCookie(name: string): void {
  document.cookie = `${name}=; path=/; max-age=0; samesite=lax`;
}

// the go server renders the first byte from this cookie, so the app's choice
// cannot live in localStorage: the server would have no way to read it
export function serverPersistence(): ThemePersistence {
  const name = 'theme';
  return {
    read: () => readCookie(name, isThemeChoice),
    write: (choice) => writeCookie(name, choice, window.location.protocol === 'https:'),
    clear: () => clearCookie(name),
  };
}

// a page of the command line keeps the choice twice, because a site opened
// from disk has only one of them shared between its pages: Firefox the
// cookie, Chromium the storage
export function pagePersistence(): ThemePersistence {
  const name = 'scrawl-page-theme';
  const key = 'scrawl.page.scheme';
  return {
    // the cookie goes first: Firefox keeps a storage per page from disk, so a
    // page may still hold a choice made on it before the one made elsewhere
    read: () => {
      const stored = readText(localStore(), key);
      return readCookie(name, isThemeChoice) ?? (stored !== undefined && isThemeChoice(stored) ? stored : undefined);
    },
    write: (choice) => {
      writeCookie(name, choice, false);
      writeText(localStore(), key, choice);
    },
    clear: () => clearCookie(name),
  };
}
