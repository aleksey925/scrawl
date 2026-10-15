import '../reader/markdown.css';
import '../diff/diff.css';
import './page.css';
import 'virtual:page-variables.css';

const schemeAttr = 'data-mantine-color-scheme';
const schemeKey = 'scrawl.page.scheme';
const schemes = ['auto', 'light', 'dark'] as const;

type Scheme = (typeof schemes)[number];

function isScheme(value: string | null | undefined): value is Scheme {
  return schemes.some((scheme) => scheme === value);
}

function stored(): Scheme {
  try {
    const value = window.localStorage.getItem(schemeKey);
    return isScheme(value) ? value : 'auto';
  } catch {
    return 'auto';
  }
}

function apply(scheme: Scheme): void {
  const root = document.documentElement;
  if (scheme === 'auto') {
    root.removeAttribute(schemeAttr);
  } else {
    root.setAttribute(schemeAttr, scheme);
  }
  for (const button of document.querySelectorAll<HTMLButtonElement>('.page-theme button')) {
    button.setAttribute('aria-pressed', String(button.dataset['scheme'] === scheme));
  }
}

apply(stored());

document.addEventListener('DOMContentLoaded', () => {
  apply(stored());
  for (const button of document.querySelectorAll<HTMLButtonElement>('.page-theme button')) {
    button.addEventListener('click', () => {
      const scheme = button.dataset['scheme'];
      if (!isScheme(scheme)) {
        return;
      }
      try {
        window.localStorage.setItem(schemeKey, scheme);
      } catch {
        // the choice holds for this visit only
      }
      apply(scheme);
    });
  }
});
