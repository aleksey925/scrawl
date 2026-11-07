import { ensureSyntaxTree, syntaxTree } from '@codemirror/language';
import type { EditorState, Line, Text } from '@codemirror/state';

import { parseBudgetMs } from './constants';

export type Tree = ReturnType<typeof syntaxTree>;

export interface TextChange {
  from: number;
  to: number;
  insert: string;
}

export interface PlacedBlock {
  change: TextChange;
  blockFrom: number;
}

const frontmatterStart = '---';
const frontmatterStops: ReadonlySet<string> = new Set(['---', '...']);
const mathFence = '$$';

export function treeOf(state: EditorState): Tree {
  return ensureSyntaxTree(state, state.doc.length, parseBudgetMs) ?? syntaxTree(state);
}

export function frontmatterEnd(doc: Text): number {
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

export function placeAfterCursorBlock(state: EditorState, tree: Tree, block: string): PlacedBlock {
  const { doc } = state;
  const line = insertLine(state, tree);
  const lead = leadOf(doc, line);
  return {
    change: { from: line.to, to: line.to, insert: `${lead}${block}${trailOf(doc, line)}` },
    blockFrom: line.to + lead.length,
  };
}
