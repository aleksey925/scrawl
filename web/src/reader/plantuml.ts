import { renderToString } from '@plantuml/core';
import viz from '@plantuml/core/viz-global.js';
import DOMPurify from 'dompurify';

interface EngineHooks {
  PLANTUML_VIZ?: { instance?: () => Promise<unknown> };
  PLANTUML_STDLIB_LOADER?: (file: string, ok: () => void, fail: (message: string) => void) => void;
}

const hooks = globalThis as typeof globalThis & EngineHooks;

const engineDarkBackground = '#1B1B1B';

const fragmentRef = /url\(\s*#([^)\s]+)\s*\)/g;

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

function useLibraries(base: string): void {
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

function scopeIds(svg: SVGSVGElement, id: string): void {
  const prefix = `${id}-`;
  const owned = new Set<string>();
  for (const node of svg.querySelectorAll('[id]')) {
    owned.add(node.id);
    node.id = prefix + node.id;
  }
  for (const node of svg.querySelectorAll('*')) {
    for (const attr of Array.from(node.attributes)) {
      if (attr.localName === 'href' && attr.value.startsWith('#') && owned.has(attr.value.slice(1))) {
        attr.value = `#${prefix}${attr.value.slice(1)}`;
      } else if (attr.value.includes('url(')) {
        attr.value = attr.value.replace(fragmentRef, (whole, ref: string) =>
          owned.has(ref) ? `url(#${prefix}${ref})` : whole,
        );
      }
    }
  }
  svg.id = id;
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
  const svg = sanitize(await draw(source, dark));
  scopeIds(svg, id);
  if (dark) {
    dropDarkBackground(svg);
  }
  return svg;
}

export const plantUML = { render, useLibraries };
