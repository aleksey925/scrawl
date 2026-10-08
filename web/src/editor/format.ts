import { EditorSelection } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';

// replaceText swaps only the span that differs, so one undo takes the
// formatting back and the caret is not thrown to the end of the document.
// Without a cursor the caret stays where codemirror maps it through the change.
export function replaceText(view: EditorView, next: string, cursor: number | undefined): void {
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
    selection:
      cursor === undefined
        ? undefined
        : EditorSelection.cursor(Math.min(Math.max(cursor, 0), next.length)),
  });
}
