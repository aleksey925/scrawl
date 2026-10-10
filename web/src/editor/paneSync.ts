import type { EditorView } from '@codemirror/view';

import { blockTopWithin, clamp, sourceBlocks } from './anchor';
import { lineSpan } from './cmAnchor';
import { readingFraction } from './constants';

// a pair of pixel positions that mean the same place in the document: one in
// the source scroller, one in the preview pane
interface Pairing {
  source: number;
  pane: number;
}

type Axis = keyof Pairing;

export interface PaneSync {
  paneTop: (view: EditorView, pane: HTMLElement) => number;
  sourceTop: (view: EditorView, pane: HTMLElement) => number;
}

// The top and bottom of every rendered block, with the ends of both documents
// around them, as a list that climbs on either axis. Everything in between is
// read off the straight line between two entries, which is what carries the
// follower through the space between two blocks as well as through a block:
// matched whole blocks at a time it stood still at a paragraph break and then
// jumped, and by source line it moved a line at a time whatever the wheel did.
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

// createPaneSync answers where the follower has to be for the leader to stay
// where it is. It keeps the measurements: a wheel sends an event a frame, and a
// long note has hundreds of blocks to measure.
export function createPaneSync(): PaneSync {
  let pairs: Pairing[] = [];
  let measured = '';

  const map = (view: EditorView, pane: HTMLElement): Pairing[] => {
    // nothing moves a block without moving one of these, and reading them costs
    // nothing beside measuring the blocks again
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
