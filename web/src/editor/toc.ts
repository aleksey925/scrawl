import { EditorState, type Line } from '@codemirror/state';
import { EditorView } from '@codemirror/view';

import type { Heading } from '../api/types';

import { placeAfterCursorBlock, treeOf, type TextChange, type Tree } from './blocks';
import { codeNodes } from './cmAnchor';

interface TextRange {
  from: number;
  to: number;
}

const tocStart = '<!-- toc -->';
const tocStop = '<!-- tocstop -->';

function label(text: string): string {
  return text.replace(/[\r\n]+/g, ' ').replace(/[\\[\]<>*_`&~$:^]/g, (mark) => `\\${mark}`);
}

export function tocBlock(headings: readonly Heading[]): string | undefined {
  if (headings.length === 0) {
    return undefined;
  }
  const open: number[] = [];
  const lines = headings.map((heading) => {
    while (open.length > 0 && (open.at(-1) ?? 0) >= heading.level) {
      open.pop();
    }
    const depth = open.length;
    open.push(heading.level);
    return `${'  '.repeat(depth)}- [${label(heading.text)}](#${heading.id})`;
  });
  return `${tocStart}\n\n${lines.join('\n')}\n\n${tocStop}`;
}

function isMarker(line: Line, marker: string): boolean {
  return line.text.trim() === marker;
}

function markerLines(state: EditorState, tree: Tree): Line[] {
  const res: Line[] = [];
  tree.iterate({
    enter: (node) => {
      if (node.name === 'CommentBlock') {
        const line = state.doc.lineAt(node.from);
        if (isMarker(line, tocStart) || isMarker(line, tocStop)) {
          res.push(line);
        }
      }
      return node.name !== 'CommentBlock' && !codeNodes.has(node.name);
    },
  });
  return res;
}

function oldBlock(state: EditorState, tree: Tree): TextRange | undefined {
  const markers = markerLines(state, tree);
  const startAt = markers.findIndex((line) => isMarker(line, tocStart));
  const start = markers[startAt];
  if (start === undefined) {
    return undefined;
  }
  const next = markers[startAt + 1];
  if (next !== undefined && isMarker(next, tocStop)) {
    return { from: start.from, to: next.to };
  }
  return { from: start.from, to: start.to };
}

function placeToc(state: EditorState, block: string): TextChange {
  const tree = treeOf(state);
  const old = oldBlock(state, tree);
  if (old !== undefined) {
    return { ...old, insert: block };
  }
  return placeAfterCursorBlock(state, tree, block).change;
}

export function writeToc(view: EditorView, block: string): void {
  const change = placeToc(view.state, block);
  view.dispatch({ changes: change, effects: EditorView.scrollIntoView(change.from, { y: 'nearest' }) });
}

export function writeTocInText(text: string, cursor: number, block: string): string {
  const state = EditorState.create({
    doc: text,
    selection: { anchor: Math.min(cursor, text.length) },
  });
  return state.update({ changes: placeToc(state, block) }).state.doc.toString();
}
