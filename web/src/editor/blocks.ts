import { ensureSyntaxTree, syntaxTree } from '@codemirror/language';
import type { EditorState, Line, Text } from '@codemirror/state';

import { parseBudgetMs } from './constants';

export type Tree = ReturnType<typeof syntaxTree>;

export type BlockNode = Tree['topNode'];

export interface TextChange {
  from: number;
  to: number;
  insert: string;
}

export interface PlacedBlock {
  change: TextChange;
  blockFrom: number;
}

interface InsertSpot {
  line: Line;
  closer: string | undefined;
}

interface MathBlock {
  close: number;
  closed: boolean;
}

interface HtmlEnd {
  open: RegExp;
  end: RegExp;
  closer: string;
}

const frontmatterStart = '---';
const frontmatterStops: ReadonlySet<string> = new Set(['---', '...']);
const mathFence = '$$';
const htmlBlocks: ReadonlySet<string> = new Set(['HTMLBlock', 'CommentBlock', 'ProcessingInstructionBlock']);
const htmlEnds: readonly HtmlEnd[] = [
  { open: /^<(script|pre|style)(?:\s|>|$)/i, end: /<\/(?:script|pre|style)>/i, closer: '</$1>' },
  { open: /^<!--/, end: /-->/, closer: '-->' },
  { open: /^<\?/, end: /\?>/, closer: '?>' },
  { open: /^<![A-Z]/, end: />/, closer: '>' },
  { open: /^<!\[CDATA\[/, end: /\]\]>/, closer: ']]>' },
];

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

function topBlock(tree: Tree, line: Line): BlockNode | undefined {
  for (let node = tree.topNode.firstChild; node !== null; node = node.nextSibling) {
    if (node.from > line.to) {
      return undefined;
    }
    if (node.to >= line.from) {
      return node;
    }
  }
  return undefined;
}

function fenceCloser(doc: Text, node: BlockNode): string | undefined {
  const marks = node.getChildren('CodeMark');
  const [open] = marks;
  return marks.length === 1 && open !== undefined ? doc.sliceString(open.from, open.to) : undefined;
}

function htmlCloser(doc: Text, node: BlockNode): string | undefined {
  const opener = doc.sliceString(node.from, doc.lineAt(node.from).to);
  const style = htmlEnds.find(({ open }) => open.test(opener));
  if (style === undefined || style.end.test(doc.sliceString(node.from, node.to))) {
    return undefined;
  }
  return opener.match(style.open)?.[0].replace(style.open, style.closer);
}

function closerOf(doc: Text, node: BlockNode): string | undefined {
  if (node.name === 'FencedCode') {
    return fenceCloser(doc, node);
  }
  return htmlBlocks.has(node.name) ? htmlCloser(doc, node) : undefined;
}

function isMathFence(line: Line): boolean {
  return line.text.trim() === mathFence;
}

function mathAround(doc: Text, tree: Tree, line: Line, bodyAfter: number): MathBlock | undefined {
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
    const closed = close <= doc.lines && isMathFence(doc.line(close));
    close = Math.min(close, doc.lines);
    if (line.number <= close) {
      return { close, closed };
    }
    after = close;
  }
  return undefined;
}

export function inMathOrFrontmatter(state: EditorState, tree: Tree, line: Line): boolean {
  const bodyAfter = frontmatterEnd(state.doc);
  return line.number <= bodyAfter || mathAround(state.doc, tree, line, bodyAfter) !== undefined;
}

function insertSpot(state: EditorState, tree: Tree): InsertSpot {
  const { doc } = state;
  const cursor = doc.lineAt(state.selection.main.head);
  const bodyAfter = frontmatterEnd(doc);
  if (cursor.number <= bodyAfter) {
    return { line: doc.line(bodyAfter), closer: undefined };
  }
  const math = mathAround(doc, tree, cursor, bodyAfter);
  const inner = doc.line(math?.close ?? cursor.number);
  if (math !== undefined && !math.closed) {
    return { line: inner, closer: mathFence };
  }
  const block = topBlock(tree, inner);
  if (block === undefined) {
    return { line: inner, closer: undefined };
  }
  return { line: doc.lineAt(block.to), closer: closerOf(doc, block) };
}

function leadOf(doc: Text, { line, closer }: InsertSpot): string {
  if (closer !== undefined) {
    return `${line.length > 0 ? '\n' : ''}${closer}\n\n`;
  }
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
  const spot = insertSpot(state, tree);
  const { line } = spot;
  const lead = leadOf(doc, spot);
  return {
    change: { from: line.to, to: line.to, insert: `${lead}${block}${trailOf(doc, line)}` },
    blockFrom: line.to + lead.length,
  };
}
