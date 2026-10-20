import type { Mermaid } from '../reader/diagrams';
import type { Katex } from '../reader/typeset';

// the renderers are files beside this script, which is the one thing a page
// opened from disk can load: no module, no fetch. The script is only current
// while it runs, so where it sits is taken now.
const base = document.currentScript instanceof HTMLScriptElement ? document.currentScript.src : window.location.href;

const attached = new Map<string, Promise<void>>();

function attach(file: string, make: (url: string) => HTMLElement): Promise<void> {
  let loaded = attached.get(file);
  if (loaded === undefined) {
    loaded = new Promise<void>((resolve, reject) => {
      const element = make(new URL(file, base).href);
      element.addEventListener('load', () => resolve());
      element.addEventListener('error', () => reject(new Error(`${file} did not load`)));
      document.head.append(element);
    });
    attached.set(file, loaded);
  }
  return loaded;
}

function script(url: string): HTMLElement {
  const element = document.createElement('script');
  element.src = url;
  return element;
}

function stylesheet(url: string): HTMLElement {
  const element = document.createElement('link');
  element.rel = 'stylesheet';
  element.href = url;
  return element;
}

function loaded<T>(value: T | undefined, file: string): T {
  if (value === undefined) {
    throw new Error(`${file} set nothing`);
  }
  return value;
}

export async function loadMermaid(): Promise<Mermaid> {
  await attach('diagrams.js', script);
  return loaded(window.scrawlMermaid, 'diagrams.js');
}

export async function loadKatex(): Promise<Katex> {
  await Promise.all([attach('math.js', script), attach('math.css', stylesheet)]);
  return loaded(window.scrawlKatex, 'math.js');
}
