import '../reader/markdown.css';
import '../diff/diff.css';
import './page.css';
import 'virtual:theme-stylesheet.css';

import { applyThemeAttribute, autoChoice, isThemeChoice } from '../themes';

const choiceKey = 'scrawl.page.scheme';
// a page opened from disk is an origin of its own in Firefox, so the storage
// the next page reads is empty; there the choice rides on the links instead
const choiceParam = 'theme';
const fromDisk = window.location.protocol === 'file:';

function carried(): string | undefined {
  if (!fromDisk) {
    return undefined;
  }
  const value = new URLSearchParams(window.location.search).get(choiceParam);
  return value !== null && isThemeChoice(value) ? value : undefined;
}

function withChoice(url: URL, choice: string): string {
  if (choice === autoChoice) {
    url.searchParams.delete(choiceParam);
  } else {
    url.searchParams.set(choiceParam, choice);
  }
  return url.href;
}

// carry puts the choice on every link to another page of the site, and on the
// address itself, so a reload keeps it too
function carry(choice: string): void {
  if (!fromDisk) {
    return;
  }
  for (const link of document.querySelectorAll<HTMLAnchorElement>('a[href]')) {
    const url = new URL(link.href);
    // an anchor on this page would turn into a reload
    if (link.getAttribute('href')?.startsWith('#') || url.protocol !== 'file:' || !url.pathname.endsWith('.html')) {
      continue;
    }
    link.href = withChoice(url, choice);
  }
  try {
    window.history.replaceState(window.history.state, '', withChoice(new URL(window.location.href), choice));
  } catch {
    // the address keeps the old choice, the links already carry the new one
  }
}

function stored(): string {
  const fromLink = carried();
  if (fromLink !== undefined) {
    return fromLink;
  }
  try {
    const value = window.localStorage.getItem(choiceKey);
    return value !== null && isThemeChoice(value) ? value : autoChoice;
  } catch {
    return autoChoice;
  }
}

function apply(choice: string): void {
  applyThemeAttribute(choice);
  for (const button of document.querySelectorAll<HTMLButtonElement>('.page-theme button')) {
    button.setAttribute('aria-pressed', String(button.dataset['theme'] === choice));
  }
}

apply(stored());

document.addEventListener('DOMContentLoaded', () => {
  apply(stored());
  carry(stored());
  for (const button of document.querySelectorAll<HTMLButtonElement>('.page-theme button')) {
    button.addEventListener('click', () => {
      const choice = button.dataset['theme'];
      if (choice === undefined || !isThemeChoice(choice)) {
        return;
      }
      try {
        window.localStorage.setItem(choiceKey, choice);
      } catch {
        // the choice holds for this visit only
      }
      apply(choice);
      carry(choice);
    });
  }
});
