import { applyChoiceAttributes, autoChoice, colorSchemeAttribute, schemeOfChoice, themeAttribute } from './themes';

// paperTheme is what a note is printed in whatever the screen shows: a browser
// leaves the page background out, and the pale letters of a dark theme came
// out pale on white paper
export const paperTheme = 'light';

export function onDarkScreen(): boolean {
  return schemeOfChoice(document.documentElement.getAttribute(themeAttribute) ?? autoChoice) === 'dark';
}

function restoreAttribute(name: string, value: string | null): void {
  if (value === null) {
    document.documentElement.removeAttribute(name);
  } else {
    document.documentElement.setAttribute(name, value);
  }
}

// printInLight puts every print of the page on the paper theme, the browser's
// own menu and shortcut included. It changes the attributes alone, because
// beforeprint gives no time to redraw a diagram; the export menu does that.
export function printInLight(): void {
  let restore: (() => void) | undefined;
  window.addEventListener('beforeprint', () => {
    if (!onDarkScreen()) {
      return;
    }
    const saved = [themeAttribute, colorSchemeAttribute].map(
      (name) => [name, document.documentElement.getAttribute(name)] as const,
    );
    applyChoiceAttributes(paperTheme);
    restore = () => {
      for (const [name, value] of saved) {
        restoreAttribute(name, value);
      }
    };
  });
  window.addEventListener('afterprint', () => {
    restore?.();
    restore = undefined;
  });
}
