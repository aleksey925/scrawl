import '../reader/markdown.css';
import '../diff/diff.css';
import './page.css';
import 'virtual:theme-stylesheet.css';

import { copyText } from '../reader/clipboard';
import { anchorClass, copyClass, copyCode, injectCopyButtons, injectHeadingAnchors, sectionLink } from '../reader/controls';
import { isPlainClick } from '../reader/links';
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

// the reading controls the app puts on a note, without the picture viewer: a
// page has nothing to show a picture in, so an image is not made a button
function prepareNote(note: HTMLElement): void {
  injectHeadingAnchors(note);
  injectCopyButtons(note);
  const timers = new Set<number>();
  note.addEventListener('click', (event) => {
    if (!isPlainClick(event) || !(event.target instanceof Element)) {
      return;
    }
    const button = event.target.closest(`.${copyClass}`);
    if (button instanceof HTMLElement) {
      event.preventDefault();
      void copyCode(button, timers);
      return;
    }
    // the browser follows the anchor to its heading, the link is copied beside
    const anchor = event.target.closest(`.${anchorClass}`);
    if (anchor instanceof HTMLElement) {
      void copyText(sectionLink(anchor.dataset['headingId'] ?? ''));
    }
  });
}

const drawerOpen = 'site-tree-open';

// the tree of a site is a drawer below the rail's breakpoint; what it covers
// is made inert, so a tab cannot land on a link nobody can see
function prepareDrawer(burger: HTMLButtonElement): void {
  const behind = document.querySelectorAll<HTMLElement>('.site-main, .site-outline');
  const show = (open: boolean): void => {
    document.documentElement.classList.toggle(drawerOpen, open);
    burger.setAttribute('aria-expanded', String(open));
    for (const element of behind) {
      element.inert = open;
    }
  };
  burger.addEventListener('click', () => {
    show(!document.documentElement.classList.contains(drawerOpen));
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && document.documentElement.classList.contains(drawerOpen)) {
      show(false);
      burger.focus();
    }
  });
  // the stylesheet hides the button where the tree is a rail, so a drawer left
  // open on a phone turned sideways does not keep the note inert
  window.addEventListener('resize', () => {
    if (burger.offsetParent === null && document.documentElement.classList.contains(drawerOpen)) {
      show(false);
    }
  });
}

document.addEventListener('DOMContentLoaded', () => {
  apply(stored());
  const burger = document.querySelector<HTMLButtonElement>('.site-burger');
  if (burger !== null) {
    prepareDrawer(burger);
  }
  const note = document.querySelector<HTMLElement>('article.markdown-document');
  if (note !== null) {
    prepareNote(note);
  }
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
