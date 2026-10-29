import type { MermaidConfig } from 'mermaid';

import type { Platform } from '../platform';
import { track } from './pending';
import { preserveScroll } from './scroll';

export type Mermaid = typeof import('mermaid').default;

export type PlantUML = typeof import('./plantuml').plantUML;

type DiagramLoaders = Pick<Platform, 'loadMermaid' | 'loadPlantUML'>;

type Draw = (id: string, source: string) => Promise<SVGElement>;

interface Kind {
  name: string;
  selector: string;
  prepare: (loaders: DiagramLoaders, dark: boolean) => Promise<Draw>;
}

interface Diagram {
  kind: Kind;
  box: HTMLElement;
  view: HTMLElement;
  source: string;
}

interface Drawn {
  item: Diagram;
  svg?: SVGElement;
  error?: string;
}

const errorLimit = 200;

let pass = 0;

function wrap(pre: HTMLElement, kind: Kind): Diagram {
  const parent = pre.parentElement;
  const existing = parent?.querySelector<HTMLElement>(':scope > .md-diagram-view');
  if (parent !== null && parent !== undefined && parent.classList.contains('md-diagram') && existing != null) {
    return { kind, box: parent, view: existing, source: pre.textContent ?? '' };
  }

  const box = document.createElement('div');
  box.className = 'md-diagram';
  pre.parentNode?.insertBefore(box, pre);
  box.append(pre);

  const view = document.createElement('div');
  view.className = 'md-diagram-view';
  box.append(view);

  return { kind, box, view, source: pre.textContent ?? '' };
}

function clearError(item: Diagram): void {
  item.box.querySelector('.md-diagram-error')?.remove();
}

function fail(item: Diagram, message: string): void {
  delete item.box.dataset.state;
  clearError(item);
  const note = document.createElement('p');
  note.className = 'md-diagram-error';
  note.textContent = message;
  item.box.append(note);
}

function firstLine(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return (text.split('\n')[0] ?? '').slice(0, errorLimit);
}

function repairActors(svg: SVGElement, text: string): void {
  if (svg.id === '') {
    return;
  }
  const style = document.createElementNS('http://www.w3.org/2000/svg', 'style');
  style.textContent = `#${svg.id} text.actor > tspan { fill: ${text}; stroke: none; }`;
  svg.append(style);
}

function parseMermaidSvg(svg: string): SVGElement {
  const parsed = new DOMParser().parseFromString(svg, 'image/svg+xml');
  if (parsed.querySelector('parsererror') !== null) {
    throw new Error('mermaid returned invalid svg');
  }
  return document.importNode(parsed.documentElement, true) as unknown as SVGElement;
}

function place(result: Drawn): void {
  const { item, svg, error } = result;
  if (svg === undefined) {
    fail(item, error ?? 'the diagram could not be rendered');
    return;
  }
  item.view.replaceChildren(svg);
  item.box.dataset.state = 'done';
  clearError(item);
}

function mermaidConfig(dark: boolean): { config: MermaidConfig; text: string } {
  const style = getComputedStyle(document.documentElement);
  const token = (name: string): string => style.getPropertyValue(name).trim();

  const bg = token('--scrawl-bg');
  const inset = token('--scrawl-sidebar');
  const subtle = token('--scrawl-bg-gray');
  const note = token('--scrawl-bg-yellow');
  const text = token('--scrawl-text');
  const muted = token('--scrawl-text-secondary');
  const faint = token('--scrawl-text-tertiary');
  const border = token('--scrawl-border');
  const strong = token('--scrawl-icon-tertiary');
  const warning = token('--scrawl-color-orange');

  return {
    text,
    config: {
      startOnLoad: false,
      securityLevel: 'strict',
      theme: 'base',
      fontFamily: token('--mantine-font-family'),
      themeVariables: {
        darkMode: dark,
        fontSize: '14px',
        background: bg,
        primaryColor: inset,
        primaryTextColor: text,
        primaryBorderColor: strong,
        secondaryColor: subtle,
        tertiaryColor: subtle,
        mainBkg: inset,
        nodeBorder: strong,
        nodeTextColor: text,
        textColor: text,
        titleColor: text,
        lineColor: muted,
        edgeLabelBackground: bg,
        clusterBkg: subtle,
        clusterBorder: border,
        actorBkg: inset,
        actorBorder: strong,
        actorTextColor: text,
        actorLineColor: faint,
        signalColor: muted,
        signalTextColor: text,
        labelBoxBkgColor: inset,
        labelBoxBorderColor: strong,
        labelTextColor: text,
        loopTextColor: text,
        activationBkgColor: subtle,
        activationBorderColor: strong,
        noteBkgColor: note,
        noteBorderColor: warning,
        noteTextColor: text,
      },
      flowchart: { htmlLabels: false, useMaxWidth: false },
      class: { htmlLabels: false, useMaxWidth: false },
      sequence: { useMaxWidth: false },
      state: { useMaxWidth: false },
      er: { useMaxWidth: false },
      gantt: { useMaxWidth: false },
      pie: { useMaxWidth: false },
    },
  };
}

const mermaidKind: Kind = {
  name: 'mermaid',
  selector: 'pre.mermaid',
  prepare: async (loaders, dark) => {
    const mermaid = await loaders.loadMermaid();
    const { config, text } = mermaidConfig(dark);
    mermaid.initialize(config);
    return async (id, source) => {
      try {
        const { svg } = await mermaid.render(id, source);
        const element = parseMermaidSvg(svg);
        repairActors(element, text);
        return element;
      } catch (error) {
        document.querySelector(`body > [id="d${id}"]`)?.remove();
        throw error;
      }
    };
  },
};

const plantUMLKind: Kind = {
  name: 'plantuml',
  selector: 'pre.plantuml',
  prepare: async (loaders, dark) => {
    const plantUML = await loaders.loadPlantUML();
    return (id, source) => plantUML.render(id, source, dark);
  },
};

const diagramKinds = [mermaidKind, plantUMLKind];

const diagramSelector = diagramKinds.map((kind) => kind.selector).join(', ');

function kindOf(pre: HTMLElement): Kind | undefined {
  return diagramKinds.find((kind) => pre.matches(kind.selector));
}

async function prepareAll(diagrams: Diagram[], loaders: DiagramLoaders, dark: boolean): Promise<Map<Kind, Draw>> {
  const used = Array.from(new Set(diagrams.map((item) => item.kind)));
  const prepared = await Promise.all(
    used.map(async (kind) => {
      try {
        return [kind, await kind.prepare(loaders, dark)] as const;
      } catch {
        return [kind, undefined] as const;
      }
    }),
  );
  const draws = new Map<Kind, Draw>();
  for (const [kind, draw] of prepared) {
    if (draw !== undefined) {
      draws.set(kind, draw);
    }
  }
  return draws;
}

export function drawDiagrams(root: HTMLElement, loaders: DiagramLoaders, dark: boolean): () => void {
  const items: Diagram[] = [];
  for (const pre of root.querySelectorAll<HTMLElement>(diagramSelector)) {
    const kind = kindOf(pre);
    if (kind !== undefined) {
      items.push(wrap(pre, kind));
    }
  }
  if (items.length === 0) {
    return () => {};
  }

  let cancelled = false;
  const run = (async () => {
    const draws = await prepareAll(items, loaders, dark);
    if (cancelled) {
      return;
    }

    pass += 1;
    const thisPass = pass;
    const drawn: Drawn[] = [];
    for (const [index, item] of items.entries()) {
      const draw = draws.get(item.kind);
      if (draw === undefined) {
        drawn.push({ item, error: 'Could not load the diagram renderer.' });
        continue;
      }
      try {
        drawn.push({ item, svg: await draw(`md-${item.kind.name}-${thisPass}-${index}`, item.source) });
      } catch (error) {
        drawn.push({ item, error: firstLine(error) });
      }
      if (cancelled) {
        return;
      }
    }

    preserveScroll(root, () => {
      for (const result of drawn) {
        place(result);
      }
    });
  })();
  track(run);

  return () => {
    cancelled = true;
  };
}
