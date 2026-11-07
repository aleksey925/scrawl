import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { ensureSyntaxTree, syntaxTree } from '@codemirror/language';
import { EditorState, type Line, type Text } from '@codemirror/state';
import { EditorView } from '@codemirror/view';

import type { Heading } from '../api/types';

import { codeNodes } from './cmAnchor';
import { tocParseBudgetMs } from './constants';

type Tree = ReturnType<typeof syntaxTree>;

interface TextRange {
  from: number;
  to: number;
}

interface TocChange extends TextRange {
  insert: string;
}

const tocStart = '<!-- toc -->';
const tocStop = '<!-- tocstop -->';
const frontmatterStart = '---';
const frontmatterStops: ReadonlySet<string> = new Set(['---', '...']);
const mathFence = '$$';

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

function treeOf(state: EditorState): Tree {
  return ensureSyntaxTree(state, state.doc.length, tocParseBudgetMs) ?? syntaxTree(state);
}

function frontmatterEnd(doc: Text): number {
  const bare = (number: number): string => doc.line(number).text.replace(/[ \t\r]+$/, '');
  if (bare(1) !== frontmatterStart) {
    return 0;
  }
  for (let number = 2; number <= doc.lines; number++) {
    if (frontmatterStops.has(bare(number))) {
      return number;
    }
  }
  return 0;
}

function isMarker(line: Line, marker: string): boolean {
  return line.text.trim() === marker;
}

function markerLines(state: EditorState, tree: Tree): Line[] {
  const bodyAfter = frontmatterEnd(state.doc);
  const res: Line[] = [];
  tree.iterate({
    enter: (node) => {
      if (node.name === 'CommentBlock') {
        const line = state.doc.lineAt(node.from);
        if (line.number > bodyAfter && (isMarker(line, tocStart) || isMarker(line, tocStop))) {
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

function topBlockEnd(tree: Tree, line: Line): number | undefined {
  for (let node = tree.topNode.firstChild; node !== null; node = node.nextSibling) {
    if (node.from > line.to) {
      return undefined;
    }
    if (node.to >= line.from) {
      return node.to;
    }
  }
  return undefined;
}

function isMathFence(line: Line): boolean {
  return line.text.trim() === mathFence;
}

function mathCloseAround(doc: Text, tree: Tree, line: Line, bodyAfter: number): number | undefined {
  let after = bodyAfter;
  for (let node = tree.topNode.firstChild; node !== null; node = node.nextSibling) {
    const open = doc.lineAt(node.from);
    if (open.number > line.number) {
      return undefined;
    }
    if (node.name !== 'Paragraph' || open.number <= after || !isMathFence(open)) {
      continue;
    }
    let close = open.number + 1;
    while (close < doc.lines && !isMathFence(doc.line(close))) {
      close++;
    }
    close = Math.min(close, doc.lines);
    if (line.number <= close) {
      return close;
    }
    after = close;
  }
  return undefined;
}

function insertLine(state: EditorState, tree: Tree): Line {
  const { doc } = state;
  const cursor = doc.lineAt(state.selection.main.head);
  const bodyAfter = frontmatterEnd(doc);
  if (cursor.number <= bodyAfter) {
    return doc.line(bodyAfter);
  }
  const inner = doc.line(mathCloseAround(doc, tree, cursor, bodyAfter) ?? cursor.number);
  const blockEnd = topBlockEnd(tree, inner);
  return blockEnd === undefined ? inner : doc.lineAt(blockEnd);
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
  const tree = treeOf(state);
  const old = oldBlock(state, tree);
  if (old !== undefined) {
    return { ...old, insert: block };
  }
  const { doc } = state;
  const line = insertLine(state, tree);
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
