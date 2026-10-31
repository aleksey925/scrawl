import type { EditorView } from '@codemirror/view';

import { blockTopWithin, clamp, sourceBlocks } from './anchor';
import { lineSpan } from './cmAnchor';
import { readingFraction } from './constants';

interface Pairing {
  source: number;
  pane: number;
}

type Axis = keyof Pairing;

export interface PaneSync {
  paneTop: (view: EditorView, pane: HTMLElement) => number;
  sourceTop: (view: EditorView, pane: HTMLElement) => number;
}

function pairings(view: EditorView, pane: HTMLElement): Pairing[] {
  const res: Pairing[] = [{ source: 0, pane: 0 }];
  for (const block of sourceBlocks(pane)) {
    const span = lineSpan(view, block);
    const top = blockTopWithin(pane, block.element);
    res.push({ source: span.top, pane: top });
    res.push({ source: span.bottom, pane: top + block.element.offsetHeight });
  }
  res.push({ source: view.scrollDOM.scrollHeight, pane: pane.scrollHeight });
  return res;
}

function project(pairs: readonly Pairing[], value: number, from: Axis): number {
  const to: Axis = from === 'source' ? 'pane' : 'source';
  let low: Pairing = { source: 0, pane: 0 };
  for (const pair of pairs) {
    if (pair[from] > value) {
      const span = pair[from] - low[from];
      const within = span > 0 ? clamp((value - low[from]) / span, 0, 1) : 0;
      return low[to] + (pair[to] - low[to]) * within;
    }
    low = pair;
  }
  return low[to];
}

export function createPaneSync(): PaneSync {
  let pairs: Pairing[] = [];
  let measured = '';

  const map = (view: EditorView, pane: HTMLElement): Pairing[] => {
    const now = `${view.scrollDOM.scrollHeight}:${pane.scrollHeight}:${pane.clientWidth}`;
    if (now !== measured) {
      measured = now;
      pairs = pairings(view, pane);
    }
    return pairs;
  };

  return {
    paneTop: (view, pane) => {
      const scroller = view.scrollDOM;
      const y = scroller.scrollTop + scroller.clientHeight * readingFraction;
      return Math.max(0, project(map(view, pane), y, 'source') - pane.clientHeight * readingFraction);
    },
    sourceTop: (view, pane) => {
      const scroller = view.scrollDOM;
      const y = pane.scrollTop + pane.clientHeight * readingFraction;
      return Math.max(
        0,
        project(map(view, pane), y, 'pane') - scroller.clientHeight * readingFraction,
      );
    },
  };
}
