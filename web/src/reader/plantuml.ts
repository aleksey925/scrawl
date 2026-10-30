import { renderToString } from '@plantuml/core';
import viz from '@plantuml/core/viz-global.js';
import DOMPurify from 'dompurify';

import { paperClass, scopeIds } from './diagramSvg';

interface EngineHooks {
  PLANTUML_VIZ?: { instance?: () => Promise<unknown> };
  PLANTUML_STDLIB_LOADER?: (file: string, ok: () => void, fail: (message: string) => void) => void;
}

const hooks = globalThis as typeof globalThis & EngineHooks;

const engineDarkBackground = '#1B1B1B';

const colorLiteral = '#(?:[0-9A-Fa-f]{6}|[0-9A-Fa-f]{3}|[A-Za-z]{3,})\\b';

const ownColorLines = [
  /^!theme\b/,
  /^!include\w*\s*</,
  /^skinparam\s+\S*colou?r/i,
  /^<style>/,
  /<back:/,
  /<color[\s:]/,
  /<font\b[^>]*\scolor\s*=/,
  /\bis colored\b/,
  new RegExp(`[[<]${colorLiteral}`),
  new RegExp(`<\\w+:${colorLiteral}`),
  new RegExp(`^${colorLiteral}:`),
];

const skinparamBlock = /^skinparam\b[^{}]*\{$/i;

const colorKey = /^\S*colou?r/i;

const elementColor = new RegExp(`\\s${colorLiteral}`);

const textLine = /^(?:title|header|footer|caption|legend)\b/i;

function outsideLabels(line: string): string {
  if (textLine.test(line)) {
    return '';
  }
  return line.replace(/"[^"]*"/g, '""').split(':')[0] ?? '';
}

function hasOwnColors(source: string): boolean {
  let skinparamDepth = 0;
  for (const line of source.split('\n')) {
    const trimmed = line.trim();
    if (skinparamDepth > 0) {
      if (colorKey.test(trimmed)) {
        return true;
      }
      skinparamDepth += Number(trimmed.endsWith('{')) - Number(trimmed.startsWith('}'));
    } else if (ownColorLines.some((rule) => rule.test(trimmed)) || elementColor.test(outsideLabels(trimmed))) {
      return true;
    } else if (skinparamBlock.test(trimmed)) {
      skinparamDepth = 1;
    }
  }
  return false;
}

const libraryFile = /^[a-z0-9][a-z0-9._-]*\.js$/;

let libraryBase: string | undefined;

hooks.PLANTUML_STDLIB_LOADER = (file, ok, fail) => {
  if (libraryBase === undefined || !libraryFile.test(file)) {
    fail(`${file} is not a plantuml library`);
    return;
  }
  const script = document.createElement('script');
  script.src = new URL(file, libraryBase).href;
  script.addEventListener('load', () => ok());
  script.addEventListener('error', () => fail(`${file} did not load`));
  document.head.append(script);
};

function setLibraryBase(base: string): void {
  libraryBase = base;
}

let layout: Promise<unknown> | undefined;

hooks.PLANTUML_VIZ = {
  instance: () => {
    layout ??= viz.instance().catch((error: unknown) => {
      hooks.PLANTUML_VIZ = {};
      throw error;
    });
    return layout;
  },
};

function draw(source: string, dark: boolean): Promise<string> {
  return new Promise((resolve, reject) => {
    renderToString(source.split(/\r\n|\r|\n/), resolve, (message) => reject(new Error(message)), {
      dark,
      maxSvgSize: 0,
    });
  });
}

function sanitize(svg: string): SVGSVGElement {
  const fragment = DOMPurify.sanitize(svg, {
    USE_PROFILES: { svg: true, svgFilters: true },
    FORBID_TAGS: ['style'],
    RETURN_DOM_FRAGMENT: true,
  });
  const root = fragment.firstElementChild;
  if (!(root instanceof SVGSVGElement)) {
    throw new Error('plantuml returned no svg');
  }
  return root;
}

function dropDarkBackground(svg: SVGSVGElement): void {
  const backdrop = svg.querySelector(':scope > rect');
  if (
    backdrop === null ||
    backdrop.getAttribute('fill')?.toUpperCase() !== engineDarkBackground ||
    backdrop.getAttribute('x') !== '0' ||
    backdrop.getAttribute('y') !== '0'
  ) {
    return;
  }
  backdrop.remove();
  svg.style.removeProperty('background-color');
}

async function render(id: string, source: string, dark: boolean): Promise<SVGSVGElement> {
  const onPaper = dark && hasOwnColors(source);
  const svg = sanitize(await draw(source, dark && !onPaper));
  scopeIds(svg, id);
  if (onPaper) {
    svg.classList.add(paperClass);
  } else if (dark) {
    dropDarkBackground(svg);
  }
  return svg;
}

export const plantUML = { render, setLibraryBase };
