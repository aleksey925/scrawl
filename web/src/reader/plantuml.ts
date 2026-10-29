import '@plantuml/core/themes.js';
import '@plantuml/core/openiconic.js';
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

hooks.PLANTUML_STDLIB_LOADER = (file, _ok, fail) => {
  fail(`${file} is not bundled with scrawl`);
};

const layoutReady: Promise<void> = viz.instance().then(
  (instance) => {
    hooks.PLANTUML_VIZ = { instance: async () => instance };
  },
  () => {
    hooks.PLANTUML_VIZ = {};
  },
);

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
  await layoutReady;
  const svg = sanitize(await draw(source, dark));
  scopeIds(svg, id);
  if (dark) {
    dropDarkBackground(svg);
  }
  return svg;
}

export const plantUML = { render };
