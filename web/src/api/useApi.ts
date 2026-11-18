import { useEffect, useState, type DependencyList } from 'react';

import type { ScrawlApi } from './client';
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

const pending = new Map<string, Promise<unknown>>();

let generation = 0;

export function prefetchDir(source: Pick<ScrawlApi, 'dir'>, path: string): Promise<void> {
  const key = answerKeys.dir(path);
  const before = responses.get(key);
  const asked = generation;
  const answer = source.dir(path);
  pending.set(key, answer);
  const settle = (): void => {
    if (pending.get(key) === answer) {
      pending.delete(key);
    }
  };
  return answer.then((dir) => {
    settle();
    if (generation === asked && responses.get(key) === before) {
      remember(key, dir);
    }
  }, settle);
}

export function forgetResponses(): void {
  generation += 1;
  responses.clear();
  pending.clear();
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
    const shared = key === undefined ? undefined : (pending.get(key) as Promise<T> | undefined);
    const answer = shared === undefined ? run(controller.signal) : shared.catch(() => run(controller.signal));
    answer.then(
      (data) => {
        if (controller.signal.aborted) {
          return;
        }
        if (key !== undefined) {
          remember(key, data);
        }
        setState({ data, dataKey: key, loading: false });
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
