import type { EditorView } from '@codemirror/view';

import { clamp, holdPosition } from './anchor';
import { readingFraction } from './constants';

export function firstVisibleLine(view: EditorView): number {
  const block = view.lineBlockAtHeight(view.scrollDOM.scrollTop);
  return view.state.doc.lineAt(block.from).number;
}

export function lineAtReadingPosition(view: EditorView): number {
  const scroller = view.scrollDOM;
  const block = view.lineBlockAtHeight(scroller.scrollTop + scroller.clientHeight * readingFraction);
  return view.state.doc.lineAt(block.from).number;
}

export function scrollLineToReading(view: EditorView, line: number): void {
  const doc = view.state.doc;
  const target = doc.line(clamp(Math.round(line), 1, doc.lines));
  const block = view.lineBlockAt(target.from);
  const scroller = view.scrollDOM;

  // block.top is measured from the start of the document, which is not where
  // the scroller's own content box begins
  const docTop = view.documentTop - scroller.getBoundingClientRect().top + scroller.scrollTop;
  scroller.scrollTop = Math.max(0, docTop + block.top - scroller.clientHeight * readingFraction);
}

export function holdLineAtReading(view: EditorView, line: number): () => void {
  return holdPosition(() => scrollLineToReading(view, line), view.dom);
}
