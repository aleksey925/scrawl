import '../reader/markdown.css';
import '../diff/diff.css';
import './page.css';
import 'virtual:theme-stylesheet.css';

import { copyText } from '../reader/clipboard';
import {
  anchorClass,
  copyClass,
  copyCode,
  injectCopyButtons,
  injectHeadingAnchors,
  pictureKeyed,
  pictureOf,
  prepareImages,
  sectionLink,
} from '../reader/controls';
import { imagesOf } from '../reader/dom';
import { isPlainClick } from '../reader/links';
import { openViewer } from '../reader/viewer';
import { printInLight } from '../print';
import { pagePersistence } from '../themePersistence';
import { applyThemeAttribute, autoChoice, isThemeChoice } from '../themes';

const persistence = pagePersistence();

function stored(): string {
  return persistence.read() ?? autoChoice;
}

function apply(choice: string): void {
  applyThemeAttribute(choice);
  for (const button of document.querySelectorAll<HTMLButtonElement>('.page-theme button')) {
    button.setAttribute('aria-pressed', String(button.dataset['theme'] === choice));
  }
}

apply(stored());
printInLight();

// Back shows the page the way it was left, with the theme it had then
window.addEventListener('pageshow', (event) => {
  if (event.persisted) {
    apply(stored());
  }
});

// the reading controls the app puts on a note
function prepareNote(note: HTMLElement): void {
  injectHeadingAnchors(note);
  injectCopyButtons(note);
  prepareImages(note);
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
      return;
    }
    const image = pictureOf(event.target);
    if (image !== undefined) {
      openViewer(imagesOf(note), image);
    }
  });
  note.addEventListener('keydown', (event) => {
    const image = pictureKeyed(event);
    if (image !== undefined) {
      event.preventDefault();
      openViewer(imagesOf(note), image);
    }
  });
}

document.addEventListener('DOMContentLoaded', () => {
  apply(stored());
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
      persistence.write(choice);
      apply(choice);
    });
  }
});
