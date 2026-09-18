import { useComputedColorScheme } from '@mantine/core';
import type { MermaidConfig } from 'mermaid';
import { useEffect, type RefObject } from 'react';

import { preserveScroll } from './scroll';

type Mermaid = typeof import('mermaid').default;

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

// mermaid ships its theme as a <style> element inside the svg, and
// style-src-elem drops any style element the page inserts. The css goes through
// the cssom instead, which the policy does not cover.
let sheet: CSSStyleSheet | null = null;

// wrap puts the fence in a box that can hold either the source or the svg, so
// switching between them never loses what the author wrote
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

// unstyle takes the style element and every style attribute out of the markup:
// a parser applying them is where the policy says no, so they travel as inert
// data and come back through the cssom on the other side
function unstyle(svg: string): { markup: string; css: string } {
  const css: string[] = [];
  const markup = svg
    .replace(/<style[^>]*>([\s\S]*?)<\/style>/gi, (_all, body: string) => {
      css.push(body);
      return '';
    })
    .replace(/ style="([^"]*)"/g, (_all, value: string) => (value === '' ? '' : ` data-style="${value}"`));
  return { markup, css: css.join('\n') };
}

function restyle(root: SVGElement): void {
  const nodes = root.hasAttribute('data-style') ? [root] : [];
  nodes.push(...root.querySelectorAll<SVGElement>('[data-style]'));
  for (const node of nodes) {
    node.style.cssText = node.getAttribute('data-style') ?? '';
    node.removeAttribute('data-style');
  }
}

function adopt(css: string): void {
  if (css === '' || !('adoptedStyleSheets' in document)) {
    return;
  }
  if (sheet === null) {
    sheet = new CSSStyleSheet();
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
  }
  sheet.replaceSync(css);
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

// mermaid 11.15 had no rule for the label inside an actor box, so the text took
// its fill from the box behind it. Scoped to the same id mermaid scopes its own.
function repairActors(id: string, text: string): string {
  return id === '' ? '' : `#${id} text.actor > tspan { fill: ${text}; stroke: none; }`;
}

function place(result: Drawn, text: string): string {
  const { item, svg, error } = result;
  if (svg === undefined) {
    fail(item, error ?? 'the diagram could not be rendered');
    return '';
  }
  try {
    const { markup, css } = unstyle(svg);
    const parsed = new DOMParser().parseFromString(markup, 'image/svg+xml');
    if (parsed.querySelector('parsererror') !== null) {
      throw new Error('mermaid returned invalid svg');
    }
    const element = document.importNode(parsed.documentElement, true) as unknown as SVGElement;
    restyle(element);
    item.view.replaceChildren(element);
    item.box.dataset.state = 'done';
    clearError(item);
    return css + repairActors(element.id, text);
  } catch (error) {
    fail(item, firstLine(error));
    return '';
  }
}

// config paints mermaid with the app's own tokens, so a diagram belongs to the
// page in either theme rather than bringing a palette of its own
function mermaidConfig(dark: boolean): { config: MermaidConfig; text: string } {
  const style = getComputedStyle(document.documentElement);
  const token = (name: string, fallback: string): string => {
    const value = style.getPropertyValue(name).trim();
    return value === '' ? fallback : value;
  };

  const bg = token('--scrawl-bg', '#ffffff');
  const inset = token('--scrawl-bg-inset', '#f5f5f4');
  const subtle = token('--scrawl-bg-subtle', '#f7f7f5');
  const text = token('--scrawl-text', '#1d1d1f');
  const muted = token('--scrawl-text-secondary', '#55555c');
  const faint = token('--scrawl-text-tertiary', '#70707a');
  const border = token('--scrawl-border', '#e6e6e3');
  const strong = token('--scrawl-border-strong', '#d2d2cf');
  const warning = token('--scrawl-warning', '#9a6400');

  return {
    text,
    config: {
      startOnLoad: false,
      securityLevel: 'strict',
      theme: 'base',
      fontFamily: token('--mantine-font-family', 'sans-serif'),
      // the base theme derives what it is not given, and what it derives from
      // near white surfaces comes out too pale to read
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
        noteBkgColor: subtle,
        noteBorderColor: warning,
        noteTextColor: text,
      },
      // an html label is measured inside a live element, where the policy drops
      // the style attributes mermaid needs, and comes out mispositioned.
      // useMaxWidth is the one width mermaid writes as an inline style on the
      // live svg, and the view already holds the diagram to the column.
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

export function useMermaid(rootRef: RefObject<HTMLDivElement | null>, html: string): void {
  const colorScheme = useComputedColorScheme('light');

  useEffect(() => {
    const root = rootRef.current;
    if (root === null) {
      return undefined;
    }
    const blocks = Array.from(root.querySelectorAll<HTMLElement>('pre.mermaid'));
    if (blocks.length === 0) {
      return undefined;
    }
    const items = blocks.map(wrap);

    let cancelled = false;
    void (async () => {
      let mermaid: Mermaid;
      try {
        mermaid = (await import('mermaid')).default;
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
      const { config, text } = mermaidConfig(colorScheme === 'dark');
      mermaid.initialize(config);

      const drawn: Drawn[] = [];
      for (const [index, item] of items.entries()) {
        // a fresh id every pass: mermaid looks its scratch element up by id, and
        // the svg already on the page would answer for the previous one
        const id = `md-mermaid-${pass}-${index}`;
        try {
          const { svg } = await mermaid.render(id, item.source);
          drawn.push({ item, svg });
        } catch (error) {
          // a parse failure leaves mermaid's scratch element on the body, where
          // it is found by shape rather than by a bare id a note could carry
          document.querySelector(`body > [id="d${id}"]`)?.remove();
          drawn.push({ item, error: firstLine(error) });
        }
      }
      if (cancelled) {
        return;
      }

      preserveScroll(root, () => {
        const css = drawn.map((result) => place(result, text));
        adopt(css.join('\n'));
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [rootRef, html, colorScheme]);
}
