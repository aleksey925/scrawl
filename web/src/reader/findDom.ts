import type { FindMatch } from './findMatches';

// katex and mermaid own their subtrees: a mark spliced into one corrupts the
// rendering, and .math is source that typesetting detaches marks from; the
// head of a code block is the app's own words
const skipSelector = 'script, style, svg, .katex, .math, .mermaid, .md-anchor, .md-code-head';

// a block is a unit of text a match may run across, inline markup included: a
// paragraph, a heading, a list item, a cell, a line of code
const blockSelector = 'p, h1, h2, h3, h4, h5, h6, li, td, th, dt, dd, summary, figcaption, .line, pre';

export const hitClass = 'md-find';

interface Piece {
  node: Text;
  start: number;
}

// FindBlock is the joined visible text of one block and the text nodes it
// was joined from
export interface FindBlock {
  element: Element;
  text: string;
  pieces: Piece[];
}

// blocksOf joins the text nodes of every block of a note, the way the search
// index flattens a line, so a phrase across bold is one string
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
    const element = node.parentElement?.closest(blockSelector) ?? root;
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

// markMatches wraps every match in one mark per text node it covers, and
// returns the marks of each match together, in the order of the matches
export function markMatches(blocks: readonly FindBlock[], matches: readonly FindMatch[]): HTMLElement[][] {
  const groups: HTMLElement[][] = matches.map(() => []);
  // per text node the ranges to wrap, wrapped from the end so the offsets of
  // the earlier ones stay where they were
  const ranges = new Map<Text, { from: number; to: number; match: number }[]>();
  matches.forEach((match, index) => {
    const block = blocks[match.block];
    if (block === undefined) {
      return;
    }
    for (const piece of block.pieces) {
      const length = piece.node.nodeValue?.length ?? 0;
      const from = Math.max(match.start - piece.start, 0);
      const to = Math.min(match.end - piece.start, length);
      if (from >= to) {
        continue;
      }
      const list = ranges.get(piece.node) ?? [];
      list.push({ from, to, match: index });
      ranges.set(piece.node, list);
    }
  });
  for (const [node, list] of ranges) {
    list.sort((a, b) => b.from - a.from);
    for (const range of list) {
      const tail = node.splitText(range.from);
      tail.splitText(range.to - range.from);
      const mark = document.createElement('mark');
      mark.className = hitClass;
      mark.dataset.testid = 'find-hit';
      mark.dataset.active = 'false';
      tail.replaceWith(mark);
      mark.append(tail);
      groups[range.match]?.unshift(mark);
    }
  }
  return groups;
}

// unmark takes the marks back out, leaving the text as it was
export function unmark(groups: readonly HTMLElement[][]): void {
  const parents = new Set<Node>();
  for (const marks of groups) {
    for (const mark of marks) {
      const parent = mark.parentNode;
      if (parent === null) {
        continue;
      }
      mark.replaceWith(...mark.childNodes);
      parents.add(parent);
    }
  }
  for (const parent of parents) {
    parent.normalize();
  }
}

// sourceRange is the lines of the source a rendered element stands for
function sourceRange(element: Element): [number, number] | undefined {
  const holder = element.closest('[data-source-start]');
  const start = Number(holder?.getAttribute('data-source-start'));
  const end = Number(holder?.getAttribute('data-source-end'));
  return Number.isFinite(start) && Number.isFinite(end) && holder !== null ? [start, end] : undefined;
}

// matchAtLine is the first match inside the block that holds a source line,
// and when that block holds none, the first match after it; the block itself
// comes back too, to scroll to when there is no match at all
export function matchAtLine(root: HTMLElement, groups: readonly HTMLElement[][], line: number): {
  match: number | undefined;
  block: Element | undefined;
} {
  for (let i = 0; i < groups.length; i++) {
    const first = groups[i]?.[0];
    const range = first === undefined ? undefined : sourceRange(first);
    if (range !== undefined && range[0] <= line && line <= range[1]) {
      return { match: i, block: first };
    }
  }
  let block: Element | undefined;
  for (const element of root.querySelectorAll('[data-source-start]')) {
    const range = sourceRange(element);
    if (range !== undefined && range[0] <= line && line <= range[1]) {
      block = element;
    }
  }
  if (block === undefined) {
    return { match: undefined, block: undefined };
  }
  const after = groups.findIndex((marks) => {
    const first = marks[0];
    return first !== undefined && (block.compareDocumentPosition(first) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
  });
  return { match: after < 0 ? undefined : after, block };
}

// reveal opens every closed details around a mark, so the current match is
// on screen and not folded away
export function reveal(mark: Element): void {
  for (let details = mark.closest('details'); details !== null; details = details.parentElement?.closest('details') ?? null) {
    if (!(details as HTMLDetailsElement).open) {
      (details as HTMLDetailsElement).open = true;
    }
  }
}
