import { useCallback, useEffect, useRef, useState } from 'react';

import { usePlatform } from '../platform';
import { keysWithPrefix, localStore, readJson, removeKey, writeJson } from '../storage';

import { draftDelayMs, draftMaxAgeMs, draftPrefix } from './constants';

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
  discard: () => void;
  flush: () => boolean;
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
  const key = `${draftPrefix}${storageScope}:${path}`;

  const [offered, setOffered] = useState<Draft | undefined>(undefined);
  const [stale, setStale] = useState(false);
  const [written, setWritten] = useState<WrittenDraft | undefined>(undefined);

  const latest = useRef({ rev, content, dirty, key });
  latest.current = { rev, content, dirty, key };

  const flush = useCallback((): boolean => {
    const now = latest.current;
    if (!now.dirty) {
      return true;
    }
    const stored = writeJson(localStore(), now.key, { rev: now.rev, content: now.content, at: Date.now() });
    setWritten(stored ? { key: now.key, rev: now.rev, content: now.content } : undefined);
    return stored;
  }, []);

  const clear = useCallback((): void => {
    removeKey(localStore(), latest.current.key);
    setWritten(undefined);
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
    setStale(stored.rev !== rev);
  }, [key, savedContent, rev]);

  useEffect(() => {
    if (!dirty) {
      return;
    }
    const timer = window.setTimeout(flush, draftDelayMs);
    return () => window.clearTimeout(timer);
  }, [content, dirty, flush]);

  useEffect(() => {
    window.addEventListener('pagehide', flush);
    return () => window.removeEventListener('pagehide', flush);
  }, [flush]);

  const dismiss = useCallback((): void => setOffered(undefined), []);
  const discard = useCallback((): void => {
    removeKey(localStore(), latest.current.key);
    setWritten(undefined);
    setOffered(undefined);
  }, []);

  const stored = written?.key === key && written.rev === rev && written.content === content;

  return { offered, stale, stored, dismiss, discard, flush, clear };
}
