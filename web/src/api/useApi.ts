import { useEffect, useState, type DependencyList } from 'react';

import type { ScrawlApi } from './client';
import type { DirListing } from './types';
import { ApiError } from './errors';

export interface AsyncState<T> {
  data?: T;
  error?: unknown;
  loading: boolean;
  stale: boolean;
}

export function errorText(error: unknown): string {
  if (error instanceof ApiError) {
    return error.message;
  }
  return error instanceof Error ? error.message : 'something went wrong';
}

const responses = new Map<string, unknown>();

const maxResponses = 60;

function remember(key: string, data: unknown): void {
  responses.delete(key);
  responses.set(key, data);
  if (responses.size > maxResponses) {
    const oldest = responses.keys().next();
    if (!oldest.done) {
      responses.delete(oldest.value);
    }
  }
}

export const answerKeys = {
  page: (path: string): string => `page:${path}`,
  dir: (path: string): string => `dir:${path}`,
  nav: 'nav',
};

export function seedResponse(key: string, data: unknown): void {
  remember(key, data);
}

type DirSource = Pick<ScrawlApi, 'dir'>;

let prefetched: { source: DirSource; path: string; answer: Promise<DirListing> } | undefined;

export function prefetchDir(source: DirSource, path: string): () => void {
  const answer = source.dir(path, { background: true });
  answer.catch(() => undefined);
  const asked = { source, path, answer };
  prefetched = asked;
  return () => {
    if (prefetched === asked) {
      prefetched = undefined;
    }
  };
}

export function dirOf(source: DirSource, path: string, signal: AbortSignal): Promise<DirListing> {
  const taken = prefetched;
  if (taken?.source !== source || taken.path !== path) {
    return source.dir(path, { signal });
  }
  prefetched = undefined;
  return taken.answer.catch(() => source.dir(path, { signal }));
}

export function forgetResponses(): void {
  responses.clear();
  prefetched = undefined;
}

interface Answer<T> {
  data?: T;
  dataKey?: string;
  error?: unknown;
  loading: boolean;
}

export function useApi<T>(
  run: (signal: AbortSignal) => Promise<T>,
  deps: DependencyList,
  key?: string,
): AsyncState<T> {
  const [state, setState] = useState<Answer<T>>(() => {
    const cached = key === undefined ? undefined : (responses.get(key) as T | undefined);
    return { data: cached, dataKey: cached === undefined ? undefined : key, loading: true };
  });

  useEffect(() => {
    const controller = new AbortController();
    const cached = key === undefined ? undefined : (responses.get(key) as T | undefined);
    setState((prev) =>
      cached === undefined ? { ...prev, error: undefined, loading: true } : { data: cached, dataKey: key, loading: true },
    );
    run(controller.signal).then(
      (data) => {
        if (controller.signal.aborted) {
          return;
        }
        const before = key === undefined ? undefined : responses.get(key);
        const kept = before !== undefined && JSON.stringify(before) === JSON.stringify(data) ? (before as T) : data;
        if (key !== undefined) {
          remember(key, kept);
        }
        setState({ data: kept, dataKey: key, loading: false });
      },
      (error: unknown) => {
        if (!controller.signal.aborted) {
          setState({ error, loading: false });
        }
      },
    );
    return () => controller.abort();
  }, deps);

  const { dataKey, ...rest } = state;
  return { ...rest, stale: key !== undefined && state.data !== undefined && dataKey !== key };
}
