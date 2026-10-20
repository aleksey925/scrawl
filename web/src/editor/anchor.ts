import { readJson, sessionStore, writeJson } from '../storage';

import { anchorPrefix, readingFraction } from './constants';

// The renderer puts the inclusive 1-based source range of every block it emits
// on the element, so a reading position survives the trip between the rendered
// page and the editor as a line rather than as a pixel offset. The offset is
// how far below the top of the screen that line was.
export interface ReadingAnchor {
  path: string;
  rev: string;
  startLine: number;
  endLine: number;
  fractionWithinBlock: number;
  offset: number;
}

export interface LineRange {
  startLine: number;
  endLine: number;
}

export interface SourceBlock extends LineRange {
  element: HTMLElement;
}

const sourceSelector = '[data-source-start][data-source-end]';

export function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), high);
}

function readBlock(element: HTMLElement): SourceBlock | undefined {
  const startLine = Number.parseInt(element.dataset.sourceStart ?? '', 10);
  const endLine = Number.parseInt(element.dataset.sourceEnd ?? '', 10);
  if (Number.isNaN(startLine) || Number.isNaN(endLine) || startLine < 1 || endLine < startLine) {
    return undefined;
  }
  return { element, startLine, endLine };
}

function annotated(root: ParentNode, innermost: boolean): SourceBlock[] {
  const res: SourceBlock[] = [];
  for (const element of root.querySelectorAll<HTMLElement>(sourceSelector)) {
    const leaf = element.querySelector(sourceSelector) === null;
    const block = leaf === innermost ? readBlock(element) : undefined;
    if (block !== undefined) {
      res.push(block);
    }
  }
  return res;
}

// nesting is annotated too, so a list and every item in it both answer the
// selector; only the innermost one is a position a reader can be at
export function sourceBlocks(root: ParentNode): SourceBlock[] {
  return annotated(root, true);
}

// a line in a container and in none of its blocks is drawn by the container
// itself, like the title row of an alert, so it maps to the container's top
function containerForLine(root: ParentNode, line: number): SourceBlock | undefined {
  let res: SourceBlock | undefined;
  for (const block of annotated(root, false)) {
    if (holdsLine(block, line) && (res === undefined || lineCount(block) < lineCount(res))) {
      res = block;
    }
  }
  return res;
}

// a highlighted fence renders a row per source line, the fences excepted, so a
// line of code is a row and not a fraction of a padded box
function codeRows(block: SourceBlock): SourceBlock[] | undefined {
  const rows = block.element.querySelectorAll<HTMLElement>('pre .line');
  if (rows.length === 0) {
    return undefined;
  }
  const span = lineCount(block);
  let first: number;
  if (rows.length === span - 2) {
    first = block.startLine + 1;
  } else if (rows.length === span) {
    first = block.startLine;
  } else {
    return undefined;
  }
  return Array.from(rows, (element, index) => {
    const line = first + index;
    return { element, startLine: line, endLine: line };
  });
}

function anchorBlocks(root: ParentNode): SourceBlock[] {
  return sourceBlocks(root).flatMap((block) => codeRows(block) ?? [block]);
}

// mantine writes its lengths as calc(3rem * 1), which no parse of the string
// reads, so the browser resolves the variable on a probe of its own
function cssPx(name: string): number {
  const probe = document.createElement('div');
  probe.style.cssText = `position: absolute; visibility: hidden; height: var(${name}, 0px)`;
  document.body.append(probe);
  const height = probe.getBoundingClientRect().height;
  probe.remove();
  return height;
}

// the reader sees the note from under the topbar
function visibleTopY(): number {
  return cssPx('--app-shell-header-offset');
}

export function blockForLine(blocks: readonly SourceBlock[], line: number): SourceBlock | undefined {
  let nearest: SourceBlock | undefined;
  let distance = Number.POSITIVE_INFINITY;
  for (const block of blocks) {
    if (holdsLine(block, line)) {
      return block;
    }
    const gap = line < block.startLine ? block.startLine - line : line - block.endLine;
    if (gap < distance) {
      distance = gap;
      nearest = block;
    }
  }
  return nearest;
}

export function documentStart(path: string, rev: string): ReadingAnchor {
  return { path, rev, startLine: 1, endLine: 1, fractionWithinBlock: 0, offset: 0 };
}

// a reader at the very top sees what comes before the first block too: the
// path row on the page, the padding of a pane
export function atDocumentStart(anchor: ReadingAnchor): boolean {
  return anchor.startLine <= 1 && anchor.fractionWithinBlock === 0;
}

function lineCount(range: LineRange): number {
  return range.endLine - range.startLine + 1;
}

function holdsLine(range: LineRange, line: number): boolean {
  return line >= range.startLine && line <= range.endLine;
}

function anchorPoint(anchor: ReadingAnchor): number {
  return anchor.startLine + anchor.fractionWithinBlock * lineCount(anchor);
}

// the editor answers with a line and the page with a block, so the anchor is a
// point on the source lines, found again in whichever block holds it
function fractionInBlock(block: LineRange, anchor: ReadingAnchor): number {
  return clamp((anchorPoint(anchor) - block.startLine) / lineCount(block), 0, 1);
}

// the source line the anchor points into, and how far into that line
export function anchorLine(anchor: ReadingAnchor): { line: number; within: number } {
  const point = anchorPoint(anchor);
  const line = Math.min(Math.floor(point), anchor.endLine);
  return { line, within: clamp(point - line, 0, 1) };
}

function anchorBlock(root: ParentNode, anchor: ReadingAnchor): SourceBlock | undefined {
  const { line } = anchorLine(anchor);
  const block = blockForLine(anchorBlocks(root), line);
  if (block === undefined || holdsLine(block, line)) {
    return block;
  }
  return containerForLine(root, line) ?? block;
}

export function blockTopWithin(container: HTMLElement, el: HTMLElement): number {
  return el.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop;
}

// undefined when the pane holds no block for the anchor, which is what the
// rendered html looks like before the first preview arrives
export function paneTopForAnchor(pane: HTMLElement, anchor: ReadingAnchor): number | undefined {
  if (atDocumentStart(anchor)) {
    return 0;
  }
  const block = anchorBlock(pane, anchor);
  if (block === undefined) {
    return undefined;
  }
  const within = block.element.getBoundingClientRect().height * fractionInBlock(block, anchor);
  return blockTopWithin(pane, block.element) + within - anchor.offset;
}

export function captureFromView(root: HTMLElement, path: string, rev: string): ReadingAnchor | undefined {
  if (window.scrollY <= 0) {
    return documentStart(path, rev);
  }
  const top = visibleTopY();
  return captureAt(root, top, window.innerHeight - top, path, rev);
}

export function captureFromPane(pane: HTMLElement, path: string, rev: string): ReadingAnchor | undefined {
  if (pane.scrollTop <= 0) {
    return documentStart(path, rev);
  }
  return captureAt(pane, pane.getBoundingClientRect().top + pane.clientTop, pane.clientHeight, path, rev);
}

export function nearTop(visibleHeight: number): number {
  return visibleHeight * readingFraction;
}

function captureAt(
  root: HTMLElement,
  top: number,
  visibleHeight: number,
  path: string,
  rev: string,
): ReadingAnchor | undefined {
  const blocks = anchorBlocks(root);
  const index = blocks.findIndex((block) => block.element.getBoundingClientRect().bottom > top);
  const cut = index === -1 ? undefined : blocks[index];
  if (cut === undefined) {
    const last = blocks[blocks.length - 1];
    return last === undefined
      ? undefined
      : { path, rev, startLine: last.startLine, endLine: last.endLine, fractionWithinBlock: 1, offset: 0 };
  }

  const rect = cut.element.getBoundingClientRect();
  const next = rect.top < top ? blocks[index + 1] : cut;
  const nextTop = next?.element.getBoundingClientRect().top;
  if (next !== undefined && nextTop !== undefined && nextTop - top <= nearTop(visibleHeight)) {
    return {
      path,
      rev,
      startLine: next.startLine,
      endLine: next.endLine,
      fractionWithinBlock: 0,
      offset: nextTop - top,
    };
  }
  return {
    path,
    rev,
    startLine: cut.startLine,
    endLine: cut.endLine,
    fractionWithinBlock: rect.height > 0 ? clamp((top - rect.top) / rect.height, 0, 1) : 0,
    offset: 0,
  };
}

export function restoreToView(root: HTMLElement, anchor: ReadingAnchor): boolean {
  if (atDocumentStart(anchor)) {
    window.scrollTo({ top: 0, behavior: 'auto' });
    return true;
  }
  const target = anchorBlock(root, anchor);
  if (target === undefined) {
    return false;
  }
  const rect = target.element.getBoundingClientRect();
  const top =
    window.scrollY + rect.top + rect.height * fractionInBlock(target, anchor) - visibleTopY() - anchor.offset;
  window.scrollTo({ top: Math.max(0, top), behavior: 'auto' });
  return true;
}

export type AnchorSlot = 'edit' | 'view';

interface StoredAnchor extends ReadingAnchor {
  consumed: boolean;
}

export function isReadingAnchor(value: unknown): value is ReadingAnchor {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Partial<ReadingAnchor>;
  return (
    typeof candidate.path === 'string' &&
    typeof candidate.rev === 'string' &&
    typeof candidate.startLine === 'number' &&
    typeof candidate.endLine === 'number' &&
    typeof candidate.fractionWithinBlock === 'number' &&
    typeof candidate.offset === 'number'
  );
}

function anchorKey(slot: AnchorSlot, path: string): string {
  return `${anchorPrefix}${slot}.${path}`;
}

export function rememberAnchor(slot: AnchorSlot, anchor: ReadingAnchor): void {
  writeJson(sessionStore(), anchorKey(slot, anchor.path), { ...anchor, consumed: false });
}

function isReload(): boolean {
  const entry = performance.getEntriesByType('navigation')[0];
  return entry instanceof PerformanceNavigationTiming && entry.type === 'reload';
}

// an anchor is spent by the navigation it was written for. Keeping it past that
// would hijack a plain link to the same page; a reload is the one case where
// the reader expects to land where they were.
export function recallAnchor(slot: AnchorSlot, path: string, replayOnReload = true): ReadingAnchor | undefined {
  const key = anchorKey(slot, path);
  const stored = readJson<StoredAnchor>(sessionStore(), key);
  if (stored === undefined || !isReadingAnchor(stored) || stored.path !== path) {
    return undefined;
  }
  if (stored.consumed && !(replayOnReload && isReload())) {
    return undefined;
  }
  writeJson(sessionStore(), key, { ...stored, consumed: true });
  return {
    path: stored.path,
    rev: stored.rev,
    startLine: stored.startLine,
    endLine: stored.endLine,
    fractionWithinBlock: stored.fractionWithinBlock,
    offset: stored.offset,
  };
}
