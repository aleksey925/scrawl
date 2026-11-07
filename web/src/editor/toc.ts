import { EditorView } from '@codemirror/view';

import type { Heading } from '../api/types';

interface TocChange {
  from: number;
  to: number;
  insert: string;
}

interface Line {
  text: string;
  from: number;
  to: number;
}

interface Fence {
  mark: string;
  length: number;
}

const tocStart = '<!-- toc -->';
const tocEnd = '<!-- tocstop -->';

const fenceOpen = /^[ \t]*(`{3,}|~{3,})(.*)$/;
const fenceClose = /^[ \t]*(`{3,}|~{3,})[ \t]*$/;

export function headingsInHtml(html: string): Heading[] {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  return Array.from(doc.querySelectorAll<HTMLHeadingElement>('h1[id], h2[id], h3[id], h4[id]'), (heading) => ({
    level: Number(heading.tagName.slice(1)),
    text: (heading.textContent ?? '').replace(/\s+/g, ' ').trim(),
    id: heading.id,
  }));
}

function label(text: string): string {
  return text.replace(/[\\[\]<>*_`&~$]/g, (mark) => `\\${mark}`);
}

export function tocBlock(headings: readonly Heading[]): string | undefined {
  const listed = headings[0]?.level === 1 ? headings.slice(1) : headings;
  if (listed.length === 0) {
    return undefined;
  }
  const open: number[] = [];
  const lines = listed.map((heading) => {
    while (open.length > 0 && (open.at(-1) ?? 0) >= heading.level) {
      open.pop();
    }
    const depth = open.length;
    open.push(heading.level);
    return `${'  '.repeat(depth)}- [${label(heading.text)}](#${heading.id})`;
  });
  return `${tocStart}\n\n${lines.join('\n')}\n\n${tocEnd}`;
}

function linesOf(doc: string): Line[] {
  const res: Line[] = [];
  let from = 0;
  for (const text of doc.split('\n')) {
    res.push({ text, from, to: from + text.length });
    from += text.length + 1;
  }
  return res;
}

function opensFence(text: string): Fence | undefined {
  const match = fenceOpen.exec(text);
  if (match === null) {
    return undefined;
  }
  const [, run = '', info = ''] = match;
  if (run.startsWith('`') && info.includes('`')) {
    return undefined;
  }
  return { mark: run.charAt(0), length: run.length };
}

function closesFence(text: string, fence: Fence): boolean {
  const run = fenceClose.exec(text)?.[1];
  return run !== undefined && run.startsWith(fence.mark) && run.length >= fence.length;
}

function markerLines(doc: string): Line[] {
  const res: Line[] = [];
  let fence: Fence | undefined;
  for (const line of linesOf(doc)) {
    if (fence !== undefined) {
      if (closesFence(line.text, fence)) {
        fence = undefined;
      }
      continue;
    }
    fence = opensFence(line.text);
    const trimmed = line.text.trim();
    if (fence === undefined && (trimmed === tocStart || trimmed === tocEnd)) {
      res.push(line);
    }
  }
  return res;
}

function oldBlock(doc: string): { from: number; to: number } | undefined {
  const markers = markerLines(doc);
  const startAt = markers.findIndex((line) => line.text.trim() === tocStart);
  if (startAt === -1) {
    return undefined;
  }
  const start = markers[startAt];
  const next = markers[startAt + 1];
  if (start === undefined) {
    return undefined;
  }
  if (next !== undefined && next.text.trim() === tocEnd) {
    return { from: start.from, to: next.to };
  }
  return { from: start.from, to: start.to };
}

function placeToc(doc: string, cursor: number, block: string): TocChange {
  const old = oldBlock(doc);
  if (old !== undefined) {
    return { ...old, insert: block };
  }
  const lineEnd = doc.indexOf('\n', cursor);
  const at = lineEnd === -1 ? doc.length : lineEnd;
  const before = doc.slice(0, at);
  const after = doc.slice(at);
  const lead = before === '' || before.endsWith('\n\n') ? '' : before.endsWith('\n') ? '\n' : '\n\n';
  const trail = after === '' ? '\n' : after === '\n' || after.startsWith('\n\n') ? '' : '\n';
  return { from: at, to: at, insert: `${lead}${block}${trail}` };
}

export function writeToc(view: EditorView, block: string): void {
  const { doc, selection } = view.state;
  const change = placeToc(doc.toString(), selection.main.head, block);
  view.dispatch({ changes: change, effects: EditorView.scrollIntoView(change.from, { y: 'nearest' }) });
}
