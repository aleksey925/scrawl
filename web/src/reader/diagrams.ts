import type { MermaidConfig } from 'mermaid';

import type { Platform } from '../platform';
import { isPlainClick } from './links';
import { track } from './pending';
import { preserveScroll } from './scroll';
import { openDiagramViewer } from './viewer';

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

const frameClass = 'md-diagram-frame';

function wrap(pre: HTMLElement, kind: Kind): Diagram {
  const parent = pre.parentElement;
  const existing = parent?.querySelector<HTMLElement>(':scope > .md-diagram-view');
  if (parent !== null && parent !== undefined && parent.classList.contains('md-diagram') && existing != null) {
    return { kind, box: parent, view: existing, source: pre.textContent ?? '' };
  }

  const box = document.createElement('div');
  box.className = 'md-diagram';
  box.dataset.state = 'drawing';
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

function openButton(): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'md-diagram-open';
  button.dataset.testid = 'diagram-open';
  button.setAttribute('aria-label', 'Open the diagram');
  return button;
}

function place(result: Drawn): void {
  const { item, svg, error } = result;
  if (svg === undefined) {
    fail(item, error ?? 'the diagram could not be rendered');
    return;
  }
  const frame = document.createElement('div');
  frame.className = frameClass;
  frame.dataset.testid = 'diagram-frame';
  frame.append(svg, openButton());
  item.view.replaceChildren(frame);
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

async function prepare(kind: Kind, loaders: DiagramLoaders, dark: boolean): Promise<Draw | undefined> {
  try {
    return await kind.prepare(loaders, dark);
  } catch {
    return undefined;
  }
}

async function drawOne(draw: Draw | undefined, item: Diagram, id: string): Promise<Drawn> {
  if (draw === undefined) {
    return { item, error: 'Could not load the diagram renderer.' };
  }
  try {
    return { item, svg: await draw(id, item.source) };
  } catch (error) {
    return { item, error: firstLine(error) };
  }
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

  let closeViewer: (() => void) | null = null;
  const openOnClick = (event: MouseEvent): void => {
    const target = event.target instanceof Element ? event.target : null;
    const frame = target?.closest(`.${frameClass}`);
    const svg = frame?.querySelector(':scope > svg');
    if (!isPlainClick(event) || target?.closest('a') != null || !(svg instanceof SVGSVGElement)) {
      return;
    }
    event.preventDefault();
    closeViewer = openDiagramViewer(svg);
  };
  root.addEventListener('click', openOnClick);

  let cancelled = false;
  pass += 1;
  const thisPass = pass;
  const drawKind = async (kind: Kind): Promise<void> => {
    const draw = await prepare(kind, loaders, dark);
    for (const [index, item] of items.entries()) {
      if (cancelled) {
        return;
      }
      if (item.kind !== kind) {
        continue;
      }
      const result = await drawOne(draw, item, `md-${kind.name}-${thisPass}-${index}`);
      if (cancelled) {
        return;
      }
      preserveScroll(root, () => place(result));
    }
  };
  const kinds = Array.from(new Set(items.map((item) => item.kind)));
  track(Promise.all(kinds.map(drawKind)));

  return () => {
    cancelled = true;
    root.removeEventListener('click', openOnClick);
    closeViewer?.();
  };
}
