import type { MermaidConfig } from 'mermaid';

import { track } from './pending';
import { preserveScroll } from './scroll';

export type Mermaid = typeof import('mermaid').default;

interface Diagram {
  box: HTMLElement;
  view: HTMLElement;
  source: string;
}

interface Drawn {
  item: Diagram;
  svg?: string;
  error?: string;
}

const errorLimit = 200;

let pass = 0;

function wrap(pre: HTMLElement): Diagram {
  const parent = pre.parentElement;
  const existing = parent?.querySelector<HTMLElement>(':scope > .md-diagram-view');
  if (parent !== null && parent !== undefined && parent.classList.contains('md-diagram') && existing != null) {
    return { box: parent, view: existing, source: pre.textContent ?? '' };
  }

  const box = document.createElement('div');
  box.className = 'md-diagram';
  pre.parentNode?.insertBefore(box, pre);
  box.append(pre);

  const view = document.createElement('div');
  view.className = 'md-diagram-view';
  box.append(view);

  return { box, view, source: pre.textContent ?? '' };
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

function place(result: Drawn, text: string): void {
  const { item, svg, error } = result;
  if (svg === undefined) {
    fail(item, error ?? 'the diagram could not be rendered');
    return;
  }
  try {
    const parsed = new DOMParser().parseFromString(svg, 'image/svg+xml');
    if (parsed.querySelector('parsererror') !== null) {
      throw new Error('mermaid returned invalid svg');
    }
    const element = document.importNode(parsed.documentElement, true) as unknown as SVGElement;
    repairActors(element, text);
    item.view.replaceChildren(element);
    item.box.dataset.state = 'done';
    clearError(item);
  } catch (error) {
    fail(item, firstLine(error));
  }
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

export const diagramSelector = 'pre.mermaid';

export function drawDiagrams(root: HTMLElement, load: () => Promise<Mermaid>, dark: boolean): () => void {
  const blocks = Array.from(root.querySelectorAll<HTMLElement>(diagramSelector));
  if (blocks.length === 0) {
    return () => {};
  }
  const items = blocks.map(wrap);

  let cancelled = false;
  const run = (async () => {
    let mermaid: Mermaid;
    try {
      mermaid = await load();
    } catch {
      for (const item of items) {
        fail(item, 'Could not load the diagram renderer.');
      }
      return;
    }
    if (cancelled) {
      return;
    }

    pass += 1;
    const { config, text } = mermaidConfig(dark);
    mermaid.initialize(config);

    const drawn: Drawn[] = [];
    for (const [index, item] of items.entries()) {
      const id = `md-mermaid-${pass}-${index}`;
      try {
        const { svg } = await mermaid.render(id, item.source);
        drawn.push({ item, svg });
      } catch (error) {
        document.querySelector(`body > [id="d${id}"]`)?.remove();
        drawn.push({ item, error: firstLine(error) });
      }
    }
    if (cancelled) {
      return;
    }

    preserveScroll(root, () => {
      for (const result of drawn) {
        place(result, text);
      }
    });
  })();
  track(run);

  return () => {
    cancelled = true;
  };
}
