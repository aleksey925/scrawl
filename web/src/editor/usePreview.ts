import { useEffect, useRef, useState } from 'react';

import { ApiError, api } from '../api/client';
import { errorText } from '../api/useApi';

import { previewDelayMs } from './constants';

export interface PreviewState {
  html: string;
  busy: boolean;
  notice?: string;
}

const tooLargeNotice = 'This document is too large to preview. Editing and saving still work.';

export function usePreview(content: string, path: string, enabled: boolean): PreviewState {
  const [state, setState] = useState<PreviewState>({ html: '', busy: false });
  const seqRef = useRef(0);
  const abortRef = useRef<AbortController | undefined>(undefined);
  // a document can be well inside the save limit and still over the smaller
  // preview one, and asking again on every keystroke only burns the throttle
  const refusedAtRef = useRef(Number.POSITIVE_INFINITY);

  useEffect(() => () => abortRef.current?.abort(), []);

  useEffect(() => {
    if (!enabled) {
      return;
    }
    if (content.length >= refusedAtRef.current) {
      setState({ html: '', busy: false, notice: tooLargeNotice });
      return;
    }

    const timer = window.setTimeout(() => {
      const seq = seqRef.current + 1;
      seqRef.current = seq;
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setState((prev) => ({ ...prev, busy: true }));

      api.preview({ content, path }, { signal: controller.signal }).then(
        (res) => {
          if (seq === seqRef.current) {
            setState({ html: res.html, busy: false });
          }
        },
        (error: unknown) => {
          if (controller.signal.aborted || seq !== seqRef.current) {
            return;
          }
          if (error instanceof ApiError && error.status === 413) {
            refusedAtRef.current = content.length;
            setState({ html: '', busy: false, notice: tooLargeNotice });
            return;
          }
          setState({ html: '', busy: false, notice: `Preview failed: ${errorText(error)}` });
        },
      );
    }, previewDelayMs);

    return () => window.clearTimeout(timer);
  }, [content, path, enabled]);

  return state;
}
