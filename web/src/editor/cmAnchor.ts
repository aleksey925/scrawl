import { syntaxTree } from '@codemirror/language';
import { EditorView } from '@codemirror/view';

import { holdPosition } from '../reader/position';

import {
  anchorLine,
  atDocumentStart,
  clamp,
  documentStart,
  nearTop,
  type LineRange,
  type ReadingAnchor,
} from './anchor';

function documentOffset(view: EditorView): number {
  const scroller = view.scrollDOM;
  return view.documentTop - scroller.getBoundingClientRect().top + scroller.scrollTop;
}

export function lineSpan(view: EditorView, range: LineRange): { top: number; bottom: number } {
  const doc = view.state.doc;
  const offset = documentOffset(view);
  const first = view.lineBlockAt(doc.line(clamp(Math.round(range.startLine), 1, doc.lines)).from);
  const last = view.lineBlockAt(doc.line(clamp(Math.round(range.endLine), 1, doc.lines)).from);
  return { top: offset + first.top, bottom: offset + last.bottom };
}

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

const alertMarker = /^>\s*\[!(?:note|tip|important|warning|caution)\]\s*$/i;

function bodyStart(view: EditorView, name: string, from: number, to: number): number {
  const doc = view.state.doc;
  const start = doc.lineAt(from);
  const skipsFirst = name === 'FencedCode' || (name === 'Paragraph' && alertMarker.test(start.text));
  return skipsFirst ? Math.min(start.number + 1, doc.lineAt(to).number) : start.number;
}

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
