import { EditorSelection } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import type { Plugin } from 'prettier';

type FormatWithCursor = (typeof import('prettier/standalone'))['formatWithCursor'];

interface Formatter {
  formatWithCursor: FormatWithCursor;
  plugins: Plugin[];
}

export interface Formatted {
  text: string;
  cursor: number;
}

let loading: Promise<Formatter> | undefined;

// The plugins are the ones `make formatter` puts in the server's copy, which
// are the ones `prettier --write note.md` loads: a note formatted here must
// come out the same from the API and from the command line.
function load(): Promise<Formatter> {
  if (loading !== undefined) {
    return loading;
  }
  const started = Promise.all([
    import('prettier/standalone'),
    import('prettier/plugins/markdown'),
    import('prettier/plugins/yaml'),
    import('prettier/plugins/babel'),
    import('prettier/plugins/estree'),
    import('prettier/plugins/typescript'),
    import('prettier/plugins/postcss'),
    import('prettier/plugins/html'),
    import('prettier/plugins/graphql'),
    import('prettier/plugins/glimmer'),
  ]).then(([prettier, ...plugins]) => ({
    formatWithCursor: prettier.formatWithCursor,
    plugins: plugins as Plugin[],
  }));
  loading = started;
  // a chunk that failed to load would otherwise fail every later attempt too
  started.catch(() => {
    if (loading === started) {
      loading = undefined;
    }
  });
  return started;
}

export function warmFormatter(): void {
  load().catch(() => undefined);
}

function clamp(value: number, max: number): number {
  return Math.min(Math.max(value, 0), max);
}

export async function formatMarkdown(text: string, cursor: number): Promise<Formatted> {
  const { formatWithCursor, plugins } = await load();
  const res = await formatWithCursor(text, {
    parser: 'markdown',
    plugins,
    cursorOffset: clamp(cursor, text.length),
  });
  return { text: res.formatted, cursor: clamp(res.cursorOffset, res.formatted.length) };
}

// replaceText swaps only the span that differs, so one undo takes the
// formatting back and the caret is not thrown to the end of the document.
// Without a cursor the caret stays where codemirror maps it through the change.
export function replaceText(view: EditorView, next: string, cursor?: number): void {
  const prev = view.state.doc.toString();
  if (prev === next) {
    return;
  }
  const shared = Math.min(prev.length, next.length);
  let head = 0;
  while (head < shared && prev.charCodeAt(head) === next.charCodeAt(head)) {
    head += 1;
  }
  let tail = 0;
  while (
    tail < shared - head &&
    prev.charCodeAt(prev.length - 1 - tail) === next.charCodeAt(next.length - 1 - tail)
  ) {
    tail += 1;
  }
  view.dispatch({
    changes: { from: head, to: prev.length - tail, insert: next.slice(head, next.length - tail) },
    selection: cursor === undefined ? undefined : EditorSelection.cursor(clamp(cursor, next.length)),
  });
}
