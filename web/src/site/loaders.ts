import type { Mermaid, PlantUML } from '../reader/diagrams';
import { plantUMLLibraryDir } from '../plantumlLibrary';
import type { Katex } from '../reader/typeset';

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
  await attach('mermaid.js', script);
  return loaded(window.scrawlMermaid, 'mermaid.js');
}

export async function loadPlantUML(): Promise<PlantUML> {
  await attach('plantuml.js', script);
  const plantUML = loaded(window.scrawlPlantUML, 'plantuml.js');
  plantUML.setLibraryBase(new URL(`${plantUMLLibraryDir}/`, base).href);
  return plantUML;
}

export async function loadKatex(): Promise<Katex> {
  await Promise.all([attach('math.js', script), attach('math.css', stylesheet)]);
  return loaded(window.scrawlKatex, 'math.js');
}
