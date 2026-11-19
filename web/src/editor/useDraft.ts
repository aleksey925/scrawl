import { useCallback, useEffect, useRef, useState } from 'react';

import { usePlatform } from '../platform';
import { keysWithPrefix, localStore, readJson, removeKey, writeJson } from '../storage';

import { draftDelayMs, draftMaxAgeMs, draftPrefix } from './constants';
import { draftKey } from './draftKeys';

export interface Draft {
  rev: string;
  content: string;
  at: number;
  name?: string;
  by?: string;
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
  moveTo: (path: string, rev: string, content: string) => boolean;
  replace: () => boolean;
  clear: () => void;
}

function isDraft(value: unknown): value is Draft {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Partial<Draft>;
  return (
    typeof candidate.content === 'string' &&
    typeof candidate.rev === 'string' &&
    (candidate.name === undefined || typeof candidate.name === 'string')
  );
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
  name?: string;
}

export function useDraft(options: UseDraftOptions): DraftControl {
  const { path, rev, content, dirty, savedContent, name } = options;
  const { storageScope } = usePlatform();
  const key = draftKey(storageScope, path);

  const [offered, setOffered] = useState<Draft | undefined>(undefined);
  const [written, setWritten] = useState<WrittenDraft | undefined>(undefined);

  const latest = useRef({ rev, content, dirty, key, name });
  latest.current = { rev, content, dirty, key, name };
  const abandonedRef = useRef(false);
  const [writer] = useState(() => Math.random().toString(36).slice(2));
  const openedAtRef = useRef(0);

  const writeDraft = useCallback(
    (target: string, draftRev: string, text: string, draftName?: string): boolean =>
      writeJson(localStore(), target, { rev: draftRev, content: text, at: Date.now(), name: draftName, by: writer }),
    [writer],
  );

  const owns = useCallback((target: string): boolean => {
    const stored = readJson<Draft>(localStore(), target);
    return stored === undefined || stored.by === writer || (stored.at ?? 0) <= openedAtRef.current;
  }, [writer]);

  const flush = useCallback((): boolean => {
    const now = latest.current;
    if (!now.dirty || abandonedRef.current) {
      return true;
    }
    const stored = writeDraft(now.key, now.rev, now.content, now.name);
    setWritten(stored ? { key: now.key, rev: now.rev, content: now.content } : undefined);
    return stored;
  }, [writeDraft]);

  const moveTo = useCallback(
    (target: string, targetRev: string, text: string): boolean => {
      if (abandonedRef.current) {
        return true;
      }
      const from = latest.current.key;
      const to = draftKey(storageScope, target);
      const moved = owns(to) && writeDraft(to, targetRev, text);
      if (to === from || offered !== undefined || !owns(from)) {
        return moved;
      }
      if (moved) {
        removeKey(localStore(), from);
      } else {
        writeDraft(from, latest.current.rev, text, latest.current.name);
      }
      return moved;
    },
    [offered, owns, storageScope, writeDraft],
  );

  const replace = useCallback((): boolean => {
    const wrote = latest.current.dirty && flush();
    if (wrote) {
      setOffered(undefined);
    }
    return wrote;
  }, [flush]);

  const clear = useCallback((): void => {
    const current = latest.current.key;
    if (owns(current)) {
      removeKey(localStore(), current);
    }
    setWritten(undefined);
    setOffered(undefined);
  }, [owns]);

  useEffect(() => {
    openedAtRef.current = Date.now();
    prune();
  }, []);

  useEffect(() => {
    const stored = readJson<unknown>(localStore(), key);
    if (
      !isDraft(stored) ||
      stored.by === writer ||
      stored.content === savedContent ||
      stored.content === latest.current.content
    ) {
      return;
    }
    setOffered(stored);
  }, [key, savedContent, writer]);

  const offering = offered !== undefined;

  useEffect(() => {
    if (!dirty || offering) {
      return;
    }
    const timer = window.setTimeout(flush, draftDelayMs);
    return () => window.clearTimeout(timer);
  }, [content, rev, name, dirty, offering, flush]);

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

  return { offered, stale, stored, dismiss, abandon, flush, moveTo, replace, clear };
}
