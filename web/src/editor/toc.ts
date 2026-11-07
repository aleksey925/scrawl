import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { ensureSyntaxTree, syntaxTree } from '@codemirror/language';
import { EditorState, type Line, type Text } from '@codemirror/state';
import { EditorView } from '@codemirror/view';

import type { Heading } from '../api/types';

import { codeNodes } from './cmAnchor';
import { tocParseBudgetMs } from './constants';

interface TextRange {
  from: number;
  to: number;
}

interface TocChange extends TextRange {
  insert: string;
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

function markerLines(state: EditorState): Line[] {
  const tree = ensureSyntaxTree(state, state.doc.length, tocParseBudgetMs) ?? syntaxTree(state);
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

function oldBlock(state: EditorState): TextRange | undefined {
  const markers = markerLines(state);
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

function leadOf(doc: Text, line: Line): string {
  if (line.length > 0) {
    return '\n\n';
  }
  if (line.number === 1 || doc.line(line.number - 1).length === 0) {
    return '';
  }
  return '\n';
}

function trailOf(doc: Text, line: Line): string {
  if (line.number === doc.lines) {
    return '\n';
  }
  return doc.line(line.number + 1).length === 0 ? '' : '\n';
}

function placeToc(state: EditorState, block: string): TocChange {
  const old = oldBlock(state);
  if (old !== undefined) {
    return { ...old, insert: block };
  }
  const { doc } = state;
  const line = doc.lineAt(state.selection.main.head);
  return { from: line.to, to: line.to, insert: `${leadOf(doc, line)}${block}${trailOf(doc, line)}` };
}

export function writeToc(view: EditorView, block: string): void {
  const change = placeToc(view.state, block);
  view.dispatch({ changes: change, effects: EditorView.scrollIntoView(change.from, { y: 'nearest' }) });
}

export function writeTocInText(text: string, cursor: number, block: string): string {
  const state = EditorState.create({
    doc: text,
    selection: { anchor: Math.min(cursor, text.length) },
    extensions: markdown({ base: markdownLanguage }),
  });
  return state.update({ changes: placeToc(state, block) }).state.doc.toString();
}
