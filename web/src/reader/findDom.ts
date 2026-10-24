import { anchorClass, codeHeadClass } from './controls';
import type { FindMatch } from './findMatches';

const skipSelector = `script, style, svg, .katex, .math, .mermaid, .${anchorClass}, .${codeHeadClass}`;

const blockSelector = 'p, h1, h2, h3, h4, h5, h6, li, td, th, dt, dd, summary, figcaption, .line, pre';

const looseSelector = 'blockquote, details, div, section, article, aside, figure, table, ul, ol, dl';

const hitClass = 'md-find';

interface Piece {
  node: Text;
  start: number;
}

export interface FindBlock {
  element: Element;
  text: string;
  pieces: Piece[];
}

export function blocksOf(root: HTMLElement): FindBlock[] {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => {
      const parent = node.parentElement;
      return parent !== null && parent.closest(skipSelector) === null ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
    },
  });
  const byElement = new Map<Element, FindBlock>();
  const res: FindBlock[] = [];
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    const parent = node.parentElement;
    const element = parent?.closest(blockSelector) ?? parent?.closest(looseSelector) ?? root;
    let block = byElement.get(element);
    if (block === undefined) {
      block = { element, text: '', pieces: [] };
      byElement.set(element, block);
      res.push(block);
    }
    block.pieces.push({ node: node as Text, start: block.text.length });
    block.text += node.nodeValue ?? '';
  }
  return res;
}

export function markMatches(blocks: readonly FindBlock[], matches: readonly FindMatch[]): HTMLElement[][] {
  const groups: HTMLElement[][] = matches.map(() => []);
  const ranges = new Map<Text, { from: number; to: number; match: number }[]>();
  matches.forEach((found, index) => {
    const block = blocks[found.block];
    if (block === undefined) {
      return;
    }
    for (const part of block.pieces) {
      const length = part.node.nodeValue?.length ?? 0;
      const from = Math.max(found.start - part.start, 0);
      const to = Math.min(found.end - part.start, length);
      if (from >= to) {
        continue;
      }
      const list = ranges.get(part.node) ?? [];
      list.push({ from, to, match: index });
      ranges.set(part.node, list);
    }
  });
  for (const [node, list] of ranges) {
    list.sort((a, b) => b.from - a.from);
    let limit = Infinity;
    for (const range of list) {
      if (range.to > limit) {
        continue;
      }
      limit = range.from;
      const tail = node.splitText(range.from);
      tail.splitText(range.to - range.from);
      const mark = document.createElement('mark');
      mark.className = hitClass;
      mark.dataset.testid = 'find-hit';
      mark.dataset.active = 'false';
      tail.replaceWith(mark);
      mark.append(tail);
      groups[range.match]?.push(mark);
    }
  }
  return groups.filter((marks) => marks.length > 0);
}

export function unmark(groups: readonly HTMLElement[][]): void {
  const touched = new Set<Node>();
  for (const matchMarks of groups) {
    for (const mark of matchMarks) {
      const parent = mark.parentNode;
      if (parent === null) {
        continue;
      }
      mark.replaceWith(...mark.childNodes);
      touched.add(parent);
    }
  }
  for (const parent of touched) {
    parent.normalize();
  }
}

function sourceRange(element: Element): [number, number] | undefined {
  const holder = element.closest('[data-source-start]');
  const start = Number(holder?.getAttribute('data-source-start'));
  const end = Number(holder?.getAttribute('data-source-end'));
  return Number.isFinite(start) && Number.isFinite(end) && holder !== null ? [start, end] : undefined;
}

function breaksBefore(from: Node, node: Node): number {
  const range = document.createRange();
  range.setStart(from, 0);
  range.setEndBefore(node);
  return range.toString().split('\n').length - 1;
}

function lineOf(mark: Element): number | undefined {
  const holder = mark.closest('[data-source-start]');
  const range = holder === null ? undefined : sourceRange(holder);
  if (holder === null || range === undefined) {
    return undefined;
  }
  const [start, end] = range;
  const code = mark.closest('pre code');
  if (code !== null && holder.contains(code)) {
    const lines = (code.textContent ?? '').replace(/\n$/, '').split('\n').length;
    const first = lines > end - start ? start : start + 1;
    return Math.min(first + breaksBefore(code, mark), end);
  }
  const row = mark.closest('tr');
  if (row !== null && holder.contains(row)) {
    const index = Array.from(holder.querySelectorAll('tr')).indexOf(row);
    return Math.min(index === 0 ? start : start + index + 1, end);
  }
  return Math.min(start + breaksBefore(holder, mark), end);
}

export function matchAtLine(root: HTMLElement, groups: readonly HTMLElement[][], line: number): {
  match: number | undefined;
  block: Element | undefined;
} {
  const at = groups.findIndex((marks) => {
    const first = marks[0];
    const found = first === undefined ? undefined : lineOf(first);
    return found !== undefined && found >= line;
  });
  if (at >= 0) {
    return { match: at, block: groups[at]?.[0] };
  }
  let block: Element | undefined;
  for (const element of root.querySelectorAll('[data-source-start]')) {
    const range = sourceRange(element);
    if (range !== undefined && range[0] <= line && line <= range[1]) {
      block = element;
    }
  }
  return { match: undefined, block };
}

export function reveal(mark: Element): void {
  for (let details = mark.closest('details'); details !== null; details = details.parentElement?.closest('details') ?? null) {
    if (!details.open) {
      details.open = true;
    }
  }
}
