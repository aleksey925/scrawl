import type { EditorView } from '@codemirror/view';

import { clamp, holdPosition, type LineRange } from './anchor';
import { readingFraction } from './constants';

export function firstVisibleLine(view: EditorView): number {
  const block = view.lineBlockAtHeight(view.scrollDOM.scrollTop);
  return view.state.doc.lineAt(block.from).number;
}

// block.top is measured from the start of the document, which is not where the
// scroller's own content box begins
function documentOffset(view: EditorView): number {
  const scroller = view.scrollDOM;
  return view.documentTop - scroller.getBoundingClientRect().top + scroller.scrollTop;
}

// lineSpan is the pixel extent of a source line range in the scroller's own
// space, which is what pairs a block of source with the block it renders as.
export function lineSpan(view: EditorView, range: LineRange): { top: number; bottom: number } {
  const doc = view.state.doc;
  const offset = documentOffset(view);
  const first = view.lineBlockAt(doc.line(clamp(Math.round(range.startLine), 1, doc.lines)).from);
  const last = view.lineBlockAt(doc.line(clamp(Math.round(range.endLine), 1, doc.lines)).from);
  return { top: offset + first.top, bottom: offset + last.bottom };
}

export function scrollLineToReading(view: EditorView, line: number): void {
  const doc = view.state.doc;
  const block = view.lineBlockAt(doc.line(clamp(Math.round(line), 1, doc.lines)).from);
  const scroller = view.scrollDOM;
  scroller.scrollTop = Math.max(
    0,
    documentOffset(view) + block.top - scroller.clientHeight * readingFraction,
  );
}

export function holdLineAtReading(view: EditorView, line: number): () => void {
  return holdPosition(() => scrollLineToReading(view, line), view.dom);
}
