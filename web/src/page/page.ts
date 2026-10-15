import '../reader/markdown.css';
import '../diff/diff.css';
import './page.css';
import 'virtual:theme-stylesheet.css';

import { applyThemeAttribute, autoChoice, isThemeChoice } from '../themes';

const choiceKey = 'scrawl.page.scheme';

function stored(): string {
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
    });
  }
});
