import { syntaxTree } from '@codemirror/language';
import { EditorView } from '@codemirror/view';

import {
  anchorLine,
  atDocumentStart,
  clamp,
  documentStart,
  holdPosition,
  nearTop,
  type LineRange,
  type ReadingAnchor,
} from './anchor';

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

// A line cut by the top edge is anchored at the first character on the top
// row, because a wrapped line is many rows tall on a phone.
export function captureFromSource(view: EditorView, path: string, rev: string): ReadingAnchor {
  const scroller = view.scrollDOM;
  if (scroller.scrollTop <= 0) {
    return documentStart(path, rev);
  }
  const doc = view.state.doc;
  const top = scroller.getBoundingClientRect().top + scroller.clientTop;
  const left = view.contentDOM.getBoundingClientRect().left;
  const pos = view.posAtCoords({ x: left, y: top + 1 }, false);
  const cut = doc.lineAt(pos);

  // the glyph and not the line box, because the glyph is what scrollIntoView
  // aligns, and the half-leading between the two would drift every round trip
  const lineTop = (from: number): number =>
    view.coordsAtPos(from, 1)?.top ?? view.documentTop + view.lineBlockAt(from).top;
  const first = lineTop(cut.from) >= top ? cut.number : cut.number + 1;
  const next = first > doc.lines ? undefined : blockLineFrom(view, first);
  const offset = next === undefined ? undefined : lineTop(doc.line(next).from) - top;
  if (next !== undefined && offset !== undefined && offset <= nearTop(scroller.clientHeight)) {
    return { path, rev, startLine: next, endLine: next, fractionWithinBlock: 0, offset };
  }
  return {
    path,
    rev,
    startLine: cut.number,
    endLine: cut.number,
    fractionWithinBlock: cut.length > 0 ? (pos - cut.from) / cut.length : 0,
    offset: 0,
  };
}

const codeNodes = new Set(['FencedCode', 'CodeBlock']);

// leaves only: the page places the blocks inside a quote or a list, and the
// container itself only where none of them is
const leafNodes = new Set([
  ...codeNodes,
  'Paragraph',
  'ATXHeading1',
  'ATXHeading2',
  'ATXHeading3',
  'ATXHeading4',
  'ATXHeading5',
  'ATXHeading6',
  'SetextHeading1',
  'SetextHeading2',
  'Table',
  'HorizontalRule',
  'HTMLBlock',
]);

// the marker line of an alert is the title row the alert draws, so its body
// starts on the next line, as it does in render
const alertMarker = /^>\s*\[!(?:note|tip|important|warning|caution)\]\s*$/i;

function bodyStart(view: EditorView, name: string, from: number, to: number): number {
  const doc = view.state.doc;
  const start = doc.lineAt(from);
  const skipsFirst = name === 'FencedCode' || (name === 'Paragraph' && alertMarker.test(start.text));
  return skipsFirst ? Math.min(start.number + 1, doc.lineAt(to).number) : start.number;
}

// the first line from number on that the page places exactly: a block's start
// or a line of code, never a later line of a paragraph or an opening fence
function blockLineFrom(view: EditorView, number: number): number | undefined {
  const doc = view.state.doc;
  const from = doc.line(number).from;
  let found: number | undefined;
  syntaxTree(view.state).iterate({
    from,
    to: view.viewport.to,
    enter: (node) => {
      if (found !== undefined) {
        return false;
      }
      if (codeNodes.has(node.name) && node.from < from && node.to > from) {
        found = number;
      } else if (node.from >= from && leafNodes.has(node.name)) {
        found = bodyStart(view, node.name, node.from, node.to);
      }
      return found === undefined;
    },
  });
  return found;
}

// not scrollTop: the height of a line not drawn yet is an estimate, hundreds of
// pixels off in a wrapped note, and scrollIntoView measures and scrolls again
export function scrollAnchorToTop(view: EditorView, anchor: ReadingAnchor): void {
  if (atDocumentStart(anchor)) {
    view.scrollDOM.scrollTop = 0;
    return;
  }
  const doc = view.state.doc;
  const { line, within } = anchorLine(anchor);
  const target = doc.line(clamp(line, 1, doc.lines));
  const pos = target.from + Math.round(within * target.length);
  view.dispatch({ effects: EditorView.scrollIntoView(pos, { y: 'start', yMargin: anchor.offset }) });
}

export function holdAnchorAtTop(view: EditorView, anchor: ReadingAnchor): () => void {
  return holdPosition(() => scrollAnchorToTop(view, anchor), view.dom);
}
