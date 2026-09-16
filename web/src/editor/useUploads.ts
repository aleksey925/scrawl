import { EditorSelection } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { useCallback, useMemo, useRef, useState } from 'react';

import { api } from '../api/client';
import { errorText } from '../api/useApi';
import { useMutationState } from '../shell/useMutationState';
import { showToast } from '../toast';

export interface UploadControl {
  pending: number;
  upload: (files: readonly File[], at?: number) => void;
  wait: () => Promise<void>;
}

function dirOf(path: string): string {
  const at = path.lastIndexOf('/');
  return at < 0 ? '' : path.slice(0, at);
}

function token(): string {
  return `uploading-${Math.random().toString(36).slice(2, 8)}`;
}

export function useUploads(path: string, getView: () => EditorView | undefined): UploadControl {
  const jobs = useRef(new Set<Promise<void>>());
  const reportMutation = useMutationState();
  const [pending, setPending] = useState(0);

  const insert = useCallback(
    (view: EditorView, text: string, at?: number): void => {
      const range = view.state.selection.main;
      const from = at ?? range.from;
      const to = at ?? range.to;
      view.dispatch({
        changes: { from, to, insert: text },
        selection: EditorSelection.cursor(from + text.length),
      });
    },
    [],
  );

  const swap = useCallback((view: EditorView, placeholder: string, text: string): void => {
    const spot = view.state.doc.toString().indexOf(placeholder);
    if (spot < 0) {
      return;
    }
    view.dispatch({ changes: { from: spot, to: spot + placeholder.length, insert: text } });
  }, []);

  const upload = useCallback(
    (files: readonly File[], at?: number): void => {
      const view = getView();
      if (view === undefined || files.length === 0) {
        return;
      }
      for (const file of files) {
        const placeholder = `![](${token()})`;
        insert(view, placeholder, at);

        const job = api
          .upload(dirOf(path), file, path)
          .then((res) => {
            const current = getView();
            if (current !== undefined) {
              swap(current, placeholder, res.markdown === '' ? `![](${res.path})` : res.markdown);
            }
            reportMutation(res, 'Image uploaded');
          })
          .catch((error: unknown) => {
            const current = getView();
            if (current !== undefined) {
              swap(current, placeholder, '');
            }
            showToast('error', { message: errorText(error) });
          })
          .finally(() => {
            jobs.current.delete(job);
            setPending(jobs.current.size);
          });

        jobs.current.add(job);
      }
      setPending(jobs.current.size);
    },
    [getView, insert, path, reportMutation, swap],
  );

  const wait = useCallback(async (): Promise<void> => {
    await Promise.allSettled(Array.from(jobs.current));
  }, []);

  return useMemo(() => ({ pending, upload, wait }), [pending, upload, wait]);
}
