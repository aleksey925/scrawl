import '../reader/markdown.css';
import '../diff/diff.css';
import './page.css';
import 'virtual:theme-stylesheet.css';

import { applyThemeAttribute, autoChoice, isThemeChoice } from '../themes';

// the choice is kept twice, because a site opened from disk has only one of
// them shared between its pages: Firefox the cookie, Chromium the storage
const choiceKey = 'scrawl.page.scheme';
const choiceCookie = 'scrawl-page-theme';
const cookieMaxAge = 60 * 60 * 24 * 365;

function fromCookie(): string | undefined {
  for (const part of document.cookie.split(';')) {
    const [name, value] = part.trim().split('=');
    if (name === choiceCookie && value !== undefined && isThemeChoice(value)) {
      return value;
    }
  }
  return undefined;
}

function fromStorage(): string | undefined {
  try {
    const value = window.localStorage.getItem(choiceKey);
    return value !== null && isThemeChoice(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

// the cookie goes first: Firefox keeps a storage per page from disk, so a page
// may still hold a choice made on it before the one made elsewhere
function stored(): string {
  return fromCookie() ?? fromStorage() ?? autoChoice;
}

function store(choice: string): void {
  document.cookie = `${choiceCookie}=${choice}; path=/; max-age=${cookieMaxAge}; samesite=lax`;
  try {
    window.localStorage.setItem(choiceKey, choice);
  } catch {
    // the cookie alone keeps it
  }
}

function apply(choice: string): void {
  applyThemeAttribute(choice);
  for (const button of document.querySelectorAll<HTMLButtonElement>('.page-theme button')) {
    button.setAttribute('aria-pressed', String(button.dataset['theme'] === choice));
  }
}

apply(stored());

// Back shows the page the way it was left, with the theme it had then
window.addEventListener('pageshow', (event) => {
  if (event.persisted) {
    apply(stored());
  }
});

document.addEventListener('DOMContentLoaded', () => {
  apply(stored());
  for (const button of document.querySelectorAll<HTMLButtonElement>('.page-theme button')) {
    button.addEventListener('click', () => {
      const choice = button.dataset['theme'];
      if (choice === undefined || !isThemeChoice(choice)) {
        return;
      }
      store(choice);
      apply(choice);
    });
  }
});
