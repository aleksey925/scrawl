import { useCallback, useEffect, useRef, useState } from 'react';

import { usePlatform } from '../platform';
import { keysWithPrefix, localStore, readJson, removeKey, writeJson } from '../storage';

import { draftDelayMs, draftMaxAgeMs, draftPrefix } from './constants';
import { draftKey } from './draftKeys';

export interface Draft {
  rev: string;
  content: string;
  at: number;
}

interface WrittenDraft {
  key: string;
  rev: string;
  content: string;
}

export interface DraftControl {
  offered: Draft | undefined;
  stale: boolean;
  stored: boolean;
  dismiss: () => void;
  abandon: () => void;
  flush: () => boolean;
  replace: () => boolean;
  clear: () => void;
}

function isDraft(value: unknown): value is Draft {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Partial<Draft>;
  return typeof candidate.content === 'string' && typeof candidate.rev === 'string';
}

function prune(): void {
  const store = localStore();
  for (const key of keysWithPrefix(store, draftPrefix)) {
    const draft = readJson<Draft>(store, key);
    if (draft === undefined || Date.now() - (draft.at ?? 0) > draftMaxAgeMs) {
      removeKey(store, key);
    }
  }
}

export interface UseDraftOptions {
  path: string;
  rev: string;
  content: string;
  dirty: boolean;
  savedContent: string;
}

export function useDraft(options: UseDraftOptions): DraftControl {
  const { path, rev, content, dirty, savedContent } = options;
  const { storageScope } = usePlatform();
  const key = draftKey(storageScope, path);

  const [offered, setOffered] = useState<Draft | undefined>(undefined);
  const [written, setWritten] = useState<WrittenDraft | undefined>(undefined);

  const latest = useRef({ rev, content, dirty, key });
  latest.current = { rev, content, dirty, key };
  const abandonedRef = useRef(false);

  const flush = useCallback((): boolean => {
    const now = latest.current;
    if (!now.dirty || abandonedRef.current) {
      return true;
    }
    const stored = writeJson(localStore(), now.key, { rev: now.rev, content: now.content, at: Date.now() });
    setWritten(stored ? { key: now.key, rev: now.rev, content: now.content } : undefined);
    return stored;
  }, []);

  const replace = useCallback((): boolean => {
    const wrote = latest.current.dirty && flush();
    if (wrote) {
      setOffered(undefined);
    }
    return wrote;
  }, [flush]);

  const clear = useCallback((): void => {
    removeKey(localStore(), latest.current.key);
    setWritten(undefined);
    setOffered(undefined);
  }, []);

  useEffect(() => {
    prune();
  }, []);

  useEffect(() => {
    const stored = readJson<unknown>(localStore(), key);
    if (!isDraft(stored) || stored.content === savedContent) {
      return;
    }
    setOffered(stored);
  }, [key, savedContent]);

  const offering = offered !== undefined;

  useEffect(() => {
    if (!dirty || offering) {
      return;
    }
    const timer = window.setTimeout(flush, draftDelayMs);
    return () => window.clearTimeout(timer);
  }, [content, dirty, offering, flush]);

  useEffect(() => {
    const onHidden = (): void => {
      if (document.hidden) {
        replace();
      }
    };
    window.addEventListener('pagehide', replace);
    document.addEventListener('visibilitychange', onHidden);
    return () => {
      window.removeEventListener('pagehide', replace);
      document.removeEventListener('visibilitychange', onHidden);
    };
  }, [replace]);

  const dismiss = useCallback((): void => setOffered(undefined), []);
  const abandon = useCallback((): void => {
    abandonedRef.current = true;
    clear();
  }, [clear]);

  const stale = offered !== undefined && offered.rev !== rev;
  const stored = written?.key === key && written.rev === rev && written.content === content;

  return { offered, stale, stored, dismiss, abandon, flush, replace, clear };
}
