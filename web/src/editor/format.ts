import { EditorSelection } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import type { Plugin } from 'prettier';

import { loadChunk } from '../staleBundle';

import { keepAlertMarkers } from './alertMarkers';

type FormatWithCursor = (typeof import('prettier/standalone'))['formatWithCursor'];

interface Formatter {
  formatWithCursor: FormatWithCursor;
  plugins: Plugin[];
}

export interface Formatted {
  text: string;
  cursor: number;
}

const noteLineWidth = 79;

interface Base {
  formatWithCursor: FormatWithCursor;
  markdown: Plugin;
  yaml: Plugin;
  alertMarkers: Plugin;
}

const fenceWithLanguage = /(?:`{3,}|~{3,})[ \t]*[^\s`~]/;

function once<T>(load: () => Promise<T>): () => Promise<T> {
  let loading: Promise<T> | undefined;
  return () => {
    if (loading !== undefined) {
      return loading;
    }
    const started = loadChunk(load());
    loading = started;
    started.catch(() => {
      if (loading === started) {
        loading = undefined;
      }
    });
    return started;
  };
}

const loadBase = once(() =>
  Promise.all([
    import('prettier/standalone'),
    import('prettier/doc'),
    import('prettier/plugins/markdown'),
    import('prettier/plugins/yaml'),
  ]).then(([prettier, doc, markdown, yaml]): Base => ({
    formatWithCursor: prettier.formatWithCursor,
    markdown: markdown as Plugin,
    yaml: yaml as Plugin,
    alertMarkers: keepAlertMarkers(markdown, doc.builders.hardline),
  })),
);

const loadCode = once(() =>
  Promise.all([
    import('prettier/plugins/babel'),
    import('prettier/plugins/estree'),
    import('prettier/plugins/typescript'),
    import('prettier/plugins/postcss'),
    import('prettier/plugins/html'),
    import('prettier/plugins/graphql'),
    import('prettier/plugins/glimmer'),
  ]).then((plugins) => plugins as Plugin[]),
);

async function load(text: string): Promise<Formatter> {
  const [base, code] = await Promise.all([loadBase(), fenceWithLanguage.test(text) ? loadCode() : []]);
  return {
    formatWithCursor: base.formatWithCursor,
    plugins: [base.markdown, base.yaml, ...code, base.alertMarkers],
  };
}

export function warmFormatter(text: string): void {
  load(text).catch(() => undefined);
}

function clamp(value: number, max: number): number {
  return Math.min(Math.max(value, 0), max);
}

export async function formatMarkdown(text: string, cursor: number): Promise<Formatted> {
  const { formatWithCursor, plugins } = await load(text);
  const res = await formatWithCursor(text, {
    parser: 'markdown',
    proseWrap: 'always',
    printWidth: noteLineWidth,
    plugins,
    cursorOffset: clamp(cursor, text.length),
  });
  return { text: res.formatted, cursor: clamp(res.cursorOffset, res.formatted.length) };
}

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
