import { useEffect, useRef, useState } from 'react';

import { api } from '../api/client';
import { ApiError } from '../api/errors';
import type { DiffRow } from '../api/types';
import { errorText } from '../api/useApi';

export interface ChangesState {
  same: boolean;
  rows?: DiffRow[];
  version: number;
  notice?: string;
}

interface Compared {
  old: string;
  new: string;
  version: number;
  rows?: DiffRow[];
  notice?: string;
}

const tooLargeNotice = 'This document is too large to compare. Editing and saving still work.';

export function useChanges(
  saved: string,
  content: string,
  path: string,
  enabled: boolean,
  paused: boolean,
): ChangesState {
  const [compared, setCompared] = useState<Compared | undefined>(undefined);
  const comparedRef = useRef(compared);
  comparedRef.current = compared;

  useEffect(() => {
    const last = comparedRef.current;
    const known = last?.old === saved && last.new === content && last.rows !== undefined;
    if (!enabled || paused || saved === content || known) {
      return;
    }
    const controller = new AbortController();
    api.compare({ path, old: saved, new: content }, { signal: controller.signal }).then(
      (res) => {
        setCompared((prev) => ({ old: saved, new: content, rows: res.changes, version: (prev?.version ?? 0) + 1 }));
      },
      (error: unknown) => {
        if (controller.signal.aborted) {
          return;
        }
        const notice =
          error instanceof ApiError && error.status === 413
            ? tooLargeNotice
            : `Could not compare: ${errorText(error)}`;
        setCompared((prev) => ({ old: saved, new: content, notice, version: prev?.version ?? 0 }));
      },
    );
    return () => controller.abort();
  }, [saved, content, path, enabled, paused]);

  const current = paused || (compared?.old === saved && compared.new === content);
  const shown = current ? compared : undefined;
  return { same: saved === content, rows: shown?.rows, notice: shown?.notice, version: shown?.version ?? 0 };
}
