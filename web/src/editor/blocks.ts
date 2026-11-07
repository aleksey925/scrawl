import type { EditorState, Line, Text } from '@codemirror/state';
import {
  type BlockContext,
  type Element,
  GFM,
  type Line as BlockLine,
  type MarkdownConfig,
  parser as commonmark,
} from '@lezer/markdown';

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

interface HtmlEnd {
  open: RegExp;
  end: RegExp;
  closer: string;
}

const frontmatterStart = '---';
const frontmatterStops: ReadonlySet<string> = new Set(['---', '...']);
const mathFence = '$$';
const mathBlock = 'MathBlock';
const mathMark = 'MathMark';
const rawHtmlOpen = /^<(script|pre|style|textarea)(?:\s|\/?>|$)/i;
const rawHtmlEnd = /<\/(?:script|pre|style|textarea)>/i;
const htmlBlocks: ReadonlySet<string> = new Set(['HTMLBlock', 'CommentBlock', 'ProcessingInstructionBlock']);
const htmlEnds: readonly HtmlEnd[] = [
  { open: rawHtmlOpen, end: rawHtmlEnd, closer: '</$1>' },
  { open: /^<!--/, end: /-->/, closer: '-->' },
  { open: /^<\?/, end: /\?>/, closer: '?>' },
  { open: /^<![A-Z]/, end: />/, closer: '>' },
  { open: /^<!\[CDATA\[/, end: /\]\]>/, closer: ']]>' },
];

function inContainer(cx: BlockContext, line: BlockLine): boolean {
  return (line as BlockLine & { depth: number }).depth >= cx.depth;
}

function lineRest(line: BlockLine): string {
  return line.text.slice(line.pos);
}

function mathOpener(rest: string): string | undefined {
  const tail = rest.slice(mathFence.length).trimEnd();
  if (!rest.startsWith(mathFence) || (tail !== '' && (tail.length < mathFence.length || !tail.endsWith(mathFence)))) {
    return undefined;
  }
  return tail;
}

function parseMath(cx: BlockContext, line: BlockLine): boolean {
  const tail = mathOpener(lineRest(line));
  if (tail === undefined) {
    return false;
  }
  const from = cx.lineStart + line.pos;
  const marks: Element[] = [cx.elt(mathMark, from, from + mathFence.length)];
  if (tail !== '') {
    const to = from + mathFence.length + tail.length;
    marks.push(cx.elt(mathMark, to - mathFence.length, to));
    cx.nextLine();
  } else {
    while (cx.nextLine() && inContainer(cx, line)) {
      marks.push(...line.markers);
      if (lineRest(line).trimEnd() === mathFence) {
        const at = cx.lineStart + line.pos;
        marks.push(cx.elt(mathMark, at, at + mathFence.length));
        cx.nextLine();
        break;
      }
    }
  }
  cx.addElement(cx.elt(mathBlock, from, cx.prevLineEnd(), marks));
  return true;
}

function parseRawHtml(cx: BlockContext, line: BlockLine): boolean {
  if (!rawHtmlOpen.test(lineRest(line))) {
    return false;
  }
  const from = cx.lineStart + line.pos;
  const marks: Element[] = [];
  let ended = true;
  while (!rawHtmlEnd.test(line.text) && cx.nextLine()) {
    if (!inContainer(cx, line)) {
      ended = false;
      break;
    }
    marks.push(...line.markers);
  }
  if (ended) {
    cx.nextLine();
  }
  cx.addElement(cx.elt('HTMLBlock', from, cx.prevLineEnd(), marks));
  return true;
}

const serverBlocks: MarkdownConfig = {
  defineNodes: [{ name: mathBlock, block: true }, mathMark],
  parseBlock: [
    { name: mathBlock, after: 'FencedCode', parse: parseMath },
    {
      name: 'RawHTMLBlock',
      before: 'HTMLBlock',
      parse: parseRawHtml,
      endLeaf: (_cx, line) => rawHtmlOpen.test(lineRest(line)),
    },
  ],
};

const serverParser = commonmark.configure([GFM, serverBlocks]);

export type Tree = ReturnType<typeof serverParser.parse>;

export type BlockNode = Tree['topNode'];

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

export function treeOf(state: EditorState): Tree {
  const { doc } = state;
  const bodyAfter = frontmatterEnd(doc);
  const bodyFrom = bodyAfter === 0 ? 0 : doc.line(bodyAfter).to;
  return serverParser.parse(doc.sliceString(0, bodyFrom).replace(/[^\n]/g, ' ') + doc.sliceString(bodyFrom));
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
  if (node.name === mathBlock) {
    return node.getChildren(mathMark).length === 1 ? mathFence : undefined;
  }
  return htmlBlocks.has(node.name) ? htmlCloser(doc, node) : undefined;
}

function insertSpot(state: EditorState, tree: Tree): InsertSpot {
  const { doc } = state;
  const cursor = doc.lineAt(state.selection.main.head);
  const bodyAfter = frontmatterEnd(doc);
  if (cursor.number <= bodyAfter) {
    return { line: doc.line(bodyAfter), closer: undefined };
  }
  const block = topBlock(tree, cursor);
  if (block === undefined) {
    return { line: cursor, closer: undefined };
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
