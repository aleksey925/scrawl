import { useEffect, useState } from 'react';

import { api } from '../api/client';
import { ApiError } from '../api/errors';
import type { DiffRow } from '../api/types';
import { errorText } from '../api/useApi';

export interface ChangesState {
  rows?: DiffRow[];
  version: number;
  notice?: string;
}

interface Compared {
  old: string;
  new: string;
  rows?: DiffRow[];
  notice?: string;
}

const tooLargeNotice = 'This document is too large to compare. Editing and saving still work.';

export function useChanges(saved: string, content: string, path: string, enabled: boolean): ChangesState {
  const [compared, setCompared] = useState<Compared | undefined>(undefined);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (!enabled || saved === content) {
      return;
    }
    const controller = new AbortController();
    api.compare({ path, old: saved, new: content }, { signal: controller.signal }).then(
      (res) => {
        setCompared({ old: saved, new: content, rows: res.changes });
        setVersion((prev) => prev + 1);
      },
      (error: unknown) => {
        if (controller.signal.aborted) {
          return;
        }
        const notice =
          error instanceof ApiError && error.status === 413
            ? tooLargeNotice
            : `Could not compare: ${errorText(error)}`;
        setCompared({ old: saved, new: content, notice });
      },
    );
    return () => controller.abort();
  }, [saved, content, path, enabled]);

  if (compared?.old !== saved || compared.new !== content) {
    return { version };
  }
  return { rows: compared.rows, notice: compared.notice, version };
}
