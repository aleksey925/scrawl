import { applyChoiceAttributes, autoChoice, colorSchemeAttribute, schemeOfChoice, themeAttribute } from './themes';

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
