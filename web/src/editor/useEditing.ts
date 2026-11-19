import type { EditorView } from '@codemirror/view';
import { useEffect, useState, type RefObject } from 'react';

export function useEditing(view: EditorView | undefined, bar: RefObject<HTMLElement | null>, enabled: boolean): boolean {
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    if (!enabled || view === undefined) {
      setEditing(false);
      return undefined;
    }
    let timer = 0;
    const check = (): void => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        const active = document.activeElement;
        setEditing(view.hasFocus || (active !== null && bar.current?.contains(active) === true));
      });
    };
    check();
    document.addEventListener('focusin', check);
    document.addEventListener('focusout', check);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('focusin', check);
      document.removeEventListener('focusout', check);
    };
  }, [view, bar, enabled]);

  return editing;
}
