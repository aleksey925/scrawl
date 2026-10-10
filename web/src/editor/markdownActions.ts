import { EditorSelection } from '@codemirror/state';
import type { EditorState } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';

export type MarkdownAction =
  | 'bold'
  | 'italic'
  | 'code'
  | 'fence'
  | 'heading'
  | 'link'
  | 'bullet'
  | 'ordered'
  | 'quote'
  | 'rule';

function toggleWrap(view: EditorView, marker: string, placeholder: string): void {
  const { state } = view;
  const range = state.selection.main;
  const text = state.sliceDoc(range.from, range.to);

  if (text === '') {
    view.dispatch({
      changes: { from: range.from, insert: marker + placeholder + marker },
      selection: EditorSelection.range(
        range.from + marker.length,
        range.from + marker.length + placeholder.length,
      ),
      scrollIntoView: true,
    });
    return;
  }

  if (text.startsWith(marker) && text.endsWith(marker) && text.length >= marker.length * 2) {
    const inner = text.slice(marker.length, text.length - marker.length);
    view.dispatch({
      changes: { from: range.from, to: range.to, insert: inner },
      selection: EditorSelection.range(range.from, range.from + inner.length),
      scrollIntoView: true,
    });
    return;
  }

  const before = state.sliceDoc(Math.max(0, range.from - marker.length), range.from);
  const after = state.sliceDoc(range.to, Math.min(state.doc.length, range.to + marker.length));
  if (before === marker && after === marker) {
    view.dispatch({
      changes: [
        { from: range.from - marker.length, to: range.from },
        { from: range.to, to: range.to + marker.length },
      ],
      selection: EditorSelection.range(range.from - marker.length, range.to - marker.length),
      scrollIntoView: true,
    });
    return;
  }

  view.dispatch({
    changes: { from: range.from, to: range.to, insert: marker + text + marker },
    selection: EditorSelection.range(range.from + marker.length, range.to + marker.length),
    scrollIntoView: true,
  });
}

function transformLines(view: EditorView, transform: (lines: string[]) => string[]): void {
  const { state } = view;
  const range = state.selection.main;
  const first = state.doc.lineAt(range.from);
  const last = state.doc.lineAt(range.to);
  const next = transform(state.sliceDoc(first.from, last.to).split('\n')).join('\n');
  view.dispatch({
    changes: { from: first.from, to: last.to, insert: next },
    selection: EditorSelection.range(first.from, first.from + next.length),
    scrollIntoView: true,
  });
}

const fenceLine = /^\s*(?:```|~~~)/;

interface Fence {
  openFrom: number;
  openTo: number;
  closeFrom: number;
  closeTo: number;
}

function enclosingFence(state: EditorState, pos: number): Fence | undefined {
  const current = state.doc.lineAt(pos).number;
  let open: number | undefined;
  for (let n = 1; n <= state.doc.lines; n += 1) {
    if (!fenceLine.test(state.doc.line(n).text)) {
      continue;
    }
    if (open === undefined) {
      open = n;
      continue;
    }
    if (current >= open && current <= n) {
      const first = state.doc.line(open);
      const last = state.doc.line(n);
      return { openFrom: first.from, openTo: first.to, closeFrom: last.from, closeTo: last.to };
    }
    open = undefined;
  }
  return undefined;
}

function toggleFence(view: EditorView): void {
  const { state } = view;
  const range = state.selection.main;
  const existing = enclosingFence(state, range.from);
  if (existing !== undefined) {
    view.dispatch({
      changes: [
        { from: existing.openFrom, to: Math.min(existing.openTo + 1, state.doc.length) },
        { from: existing.closeFrom, to: Math.min(existing.closeTo + 1, state.doc.length) },
      ],
      scrollIntoView: true,
    });
    return;
  }

  const text = state.sliceDoc(range.from, range.to);
  const lead = range.from > 0 && state.sliceDoc(range.from - 1, range.from) !== '\n' ? '\n' : '';
  const at = range.from + lead.length + 3;
  view.dispatch({
    changes: { from: range.from, to: range.to, insert: `${lead}\`\`\`\n${text}\n\`\`\`\n` },
    selection: EditorSelection.cursor(at),
    scrollIntoView: true,
  });
}

function insertRule(view: EditorView): void {
  const { state } = view;
  const at = state.selection.main.to;
  const lead = at > 0 && state.sliceDoc(at - 1, at) !== '\n' ? '\n' : '';
  const insert = `${lead}\n---\n\n`;
  view.dispatch({
    changes: { from: at, insert },
    selection: EditorSelection.cursor(at + insert.length),
    scrollIntoView: true,
  });
}

function insertLink(view: EditorView): void {
  const { state } = view;
  const range = state.selection.main;
  const text = state.sliceDoc(range.from, range.to) || 'link text';
  const insert = `[${text}](url)`;
  const at = range.from + insert.length - 4;
  view.dispatch({
    changes: { from: range.from, to: range.to, insert },
    selection: EditorSelection.range(at, at + 3),
    scrollIntoView: true,
  });
}

const headingMarker = /^(#{1,5})\s+/;
const quoteMarker = /^>\s?/;
const bulletMarker = /^\s*-\s+/;
const orderedMarker = /^\s*\d+[.)]\s+/;

export function runMarkdownAction(view: EditorView, action: MarkdownAction): void {
  switch (action) {
    case 'bold':
      toggleWrap(view, '**', 'bold text');
      break;
    case 'italic':
      toggleWrap(view, '*', 'italic text');
      break;
    case 'code':
      toggleWrap(view, '`', 'code');
      break;
    case 'fence':
      toggleFence(view);
      break;
    case 'heading':
      transformLines(view, (lines) =>
        lines.map((line) => {
          const match = headingMarker.exec(line);
          if (match === null) {
            return `# ${line}`;
          }
          const hashes = match[1] ?? '';
          return hashes.length >= 5
            ? line.slice(match[0].length)
            : `${'#'.repeat(hashes.length + 1)} ${line.slice(match[0].length)}`;
        }),
      );
      break;
    case 'quote':
      transformLines(view, (lines) => {
        const all = lines.every((line) => quoteMarker.test(line));
        return lines.map((line) => (all ? line.replace(quoteMarker, '') : `> ${line}`));
      });
      break;
    case 'bullet':
      transformLines(view, (lines) => {
        const all = lines.every((line) => bulletMarker.test(line));
        return lines.map((line) =>
          all ? line.replace(/^(\s*)-\s+/, '$1') : line.replace(/^(\s*)/, '$1- '),
        );
      });
      break;
    case 'ordered':
      transformLines(view, (lines) => {
        const all = lines.every((line) => orderedMarker.test(line));
        return lines.map((line, index) =>
          all
            ? line.replace(/^(\s*)\d+[.)]\s+/, '$1')
            : line.replace(/^(\s*)/, `$1${index + 1}. `),
        );
      });
      break;
    case 'link':
      insertLink(view);
      break;
    case 'rule':
      insertRule(view);
      break;
  }
  view.focus();
}
