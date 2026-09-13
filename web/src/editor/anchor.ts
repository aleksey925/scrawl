import { readJson, sessionStore, writeJson } from '../storage';

import { anchorPrefix, readingFraction, stabiliseDelaysMs } from './constants';

// The renderer puts the inclusive 1-based source range of every block it emits
// on the element, so a reading position survives the trip between the rendered
// page and the editor as a line rather than as a pixel offset.
export interface ReadingAnchor {
  path: string;
  rev: string;
  startLine: number;
  endLine: number;
  fractionWithinBlock: number;
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

// nesting is annotated too, so a list and every item in it both answer the
// selector; only the innermost one is a position a reader can be at
export function sourceBlocks(root: ParentNode): SourceBlock[] {
  const res: SourceBlock[] = [];
  for (const element of root.querySelectorAll<HTMLElement>(sourceSelector)) {
    if (element.querySelector(sourceSelector) !== null) {
      continue;
    }
    const startLine = Number.parseInt(element.dataset.sourceStart ?? '', 10);
    const endLine = Number.parseInt(element.dataset.sourceEnd ?? '', 10);
    if (Number.isNaN(startLine) || Number.isNaN(endLine) || startLine < 1 || endLine < startLine) {
      continue;
    }
    res.push({ element, startLine, endLine });
  }
  return res;
}

function rootFontSize(): number {
  const size = Number.parseFloat(window.getComputedStyle(document.documentElement).fontSize);
  return Number.isNaN(size) ? 16 : size;
}

// custom properties inherit, so a length the app shell defines on its own root
// is readable from any element inside it without looking that root up
export function cssPx(el: Element, name: string): number {
  const raw = window.getComputedStyle(el).getPropertyValue(name).trim();
  const value = Number.parseFloat(raw);
  if (Number.isNaN(value)) {
    return 0;
  }
  return raw.endsWith('rem') ? value * rootFontSize() : value;
}

export function readingLineY(scope: Element): number {
  const top = cssPx(scope, '--app-shell-header-offset');
  return top + (window.innerHeight - top) * readingFraction;
}

export function blockForLine(blocks: readonly SourceBlock[], line: number): SourceBlock | undefined {
  let nearest: SourceBlock | undefined;
  let distance = Number.POSITIVE_INFINITY;
  for (const block of blocks) {
    if (line >= block.startLine && line <= block.endLine) {
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

export function fractionOfLine(block: LineRange, line: number): number {
  const span = block.endLine - block.startLine + 1;
  return span <= 1 ? 0 : clamp((line - block.startLine) / span, 0, 1);
}

export function lineAtFraction(block: LineRange, fraction: number): number {
  return block.startLine + Math.round(clamp(fraction, 0, 1) * (block.endLine - block.startLine));
}

export function blockTopWithin(container: HTMLElement, el: HTMLElement): number {
  return el.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop;
}

// undefined when the pane holds no block for the line, which is what the
// rendered html looks like before the first preview arrives
export function paneTopForLine(pane: HTMLElement, line: number): number | undefined {
  const block = blockForLine(sourceBlocks(pane), line);
  if (block === undefined) {
    return undefined;
  }
  const top =
    blockTopWithin(pane, block.element) + block.element.offsetHeight * fractionOfLine(block, line);
  return Math.max(0, top - pane.clientHeight * readingFraction);
}

export function captureFromView(root: HTMLElement, path: string, rev: string): ReadingAnchor | undefined {
  const blocks = sourceBlocks(root);
  const y = readingLineY(root);

  let chosen: SourceBlock | undefined;
  for (const block of blocks) {
    if (block.element.getBoundingClientRect().bottom > y) {
      chosen = block;
      break;
    }
  }
  chosen ??= blocks[blocks.length - 1];
  if (chosen === undefined) {
    return undefined;
  }

  const rect = chosen.element.getBoundingClientRect();
  return {
    path,
    rev,
    startLine: chosen.startLine,
    endLine: chosen.endLine,
    fractionWithinBlock: rect.height > 0 ? clamp((y - rect.top) / rect.height, 0, 1) : 0,
  };
}

export function restoreToView(root: HTMLElement, anchor: ReadingAnchor): boolean {
  const target = blockForLine(sourceBlocks(root), anchor.startLine);
  if (target === undefined) {
    return false;
  }
  const rect = target.element.getBoundingClientRect();
  const exact = target.startLine === anchor.startLine && target.endLine === anchor.endLine;
  const within = exact ? rect.height * anchor.fractionWithinBlock : 0;
  const top = window.scrollY + rect.top + within - readingLineY(root);
  window.scrollTo({ top: Math.max(0, top), behavior: 'auto' });
  return true;
}

// the anchor is re-applied until the document stops moving under it, and any
// deliberate move by the reader ends that immediately
export function holdPosition(apply: () => void, watched: EventTarget): () => void {
  let stopped = false;
  const timers: number[] = [];

  const stop = (): void => {
    stopped = true;
    for (const timer of timers) {
      window.clearTimeout(timer);
    }
    for (const name of interactions) {
      watched.removeEventListener(name, stop);
    }
  };

  const interactions = ['wheel', 'touchstart', 'pointerdown', 'keydown'] as const;
  for (const name of interactions) {
    watched.addEventListener(name, stop, { passive: true });
  }
  for (const delay of stabiliseDelaysMs) {
    timers.push(
      window.setTimeout(() => {
        if (!stopped) {
          apply();
        }
      }, delay),
    );
  }
  return stop;
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
    typeof candidate.fractionWithinBlock === 'number'
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
export function recallAnchor(slot: AnchorSlot, path: string): ReadingAnchor | undefined {
  const key = anchorKey(slot, path);
  const stored = readJson<StoredAnchor>(sessionStore(), key);
  if (stored === undefined || !isReadingAnchor(stored) || stored.path !== path) {
    return undefined;
  }
  if (stored.consumed && !isReload()) {
    return undefined;
  }
  writeJson(sessionStore(), key, { ...stored, consumed: true });
  return {
    path: stored.path,
    rev: stored.rev,
    startLine: stored.startLine,
    endLine: stored.endLine,
    fractionWithinBlock: stored.fractionWithinBlock,
  };
}
