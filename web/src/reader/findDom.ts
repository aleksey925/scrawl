import { anchorClass, codeHeadClass } from './controls';
import type { FindMatch } from './findMatches';

// a mark spliced into katex or mermaid corrupts it, typesetting detaches marks
// from .math, and a code block's head is the app's own words
const skipSelector = `script, style, svg, .katex, .math, .mermaid, .${anchorClass}, .${codeHeadClass}`;

// a block is a unit of text a match may run across, inline markup included: a
// paragraph, a heading, a list item, a cell, a line of code
const blockSelector = 'p, h1, h2, h3, h4, h5, h6, li, td, th, dt, dd, summary, figcaption, .line, pre';

// text raw HTML leaves outside every block joins its nearest container: joined
// to the note, one match could run from one end of the page to the other
const looseSelector = 'blockquote, details, div, section, article, aside, figure, table, ul, ol, dl';

const hitClass = 'md-find';

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

// markMatches wraps every match in one mark per text node it covers, and
// returns the marks of each match together, in the order of the matches
export function markMatches(blocks: readonly FindBlock[], matches: readonly FindMatch[]): HTMLElement[][] {
  const groups: HTMLElement[][] = matches.map(() => []);
  // per text node the ranges to wrap, wrapped from the end so the offsets of
  // the earlier ones stay where they were
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
    // a range reaching into the one wrapped after it would split past the end
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

// unmark takes the marks back out, leaving the text as it was
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

// sourceRange is the lines of the source a rendered element stands for
function sourceRange(element: Element): [number, number] | undefined {
  const holder = element.closest('[data-source-start]');
  const start = Number(holder?.getAttribute('data-source-start'));
  const end = Number(holder?.getAttribute('data-source-end'));
  return Number.isFinite(start) && Number.isFinite(end) && holder !== null ? [start, end] : undefined;
}

// breaksBefore counts the line breaks in the text of from up to node
function breaksBefore(from: Node, node: Node): number {
  const range = document.createRange();
  range.setStart(from, 0);
  range.setEndBefore(node);
  return range.toString().split('\n').length - 1;
}

// lineOf is the source line a mark is on: a table row and a line of code are
// a line each, and a break in the text of a paragraph is one in the source
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
    // indented code fills its range; a fence's opening line is in the range and
    // not in the code, and its closing one too unless the fence was left open
    const first = lines > end - start ? start : start + 1;
    return Math.min(first + breaksBefore(code, mark), end);
  }
  const row = mark.closest('tr');
  if (row !== null && holder.contains(row)) {
    const index = Array.from(holder.querySelectorAll('tr')).indexOf(row);
    // the row under the header is the delimiter line, which renders nothing
    return Math.min(index === 0 ? start : start + index + 1, end);
  }
  return Math.min(start + breaksBefore(holder, mark), end);
}

// matchAtLine is the first match on a source line or after it; the innermost
// block holding the line comes back too, to scroll to when there is no match
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

// reveal opens every closed details around a mark, so the current match is
// on screen and not folded away
export function reveal(mark: Element): void {
  for (let details = mark.closest('details'); details !== null; details = details.parentElement?.closest('details') ?? null) {
    if (!details.open) {
      details.open = true;
    }
  }
}
