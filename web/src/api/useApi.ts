import { useEffect, useState, type DependencyList } from 'react';

import { ApiError } from './client';

export interface AsyncState<T> {
  data?: T;
  error?: unknown;
  loading: boolean;
}

export function errorText(error: unknown): string {
  if (error instanceof ApiError) {
    return error.message;
  }
  return error instanceof Error ? error.message : 'something went wrong';
}

export function useApi<T>(run: (signal: AbortSignal) => Promise<T>, deps: DependencyList): AsyncState<T> {
  const [state, setState] = useState<AsyncState<T>>({ loading: true });

  useEffect(() => {
    const controller = new AbortController();
    setState({ loading: true });
    run(controller.signal).then(
      (data) => setState({ data, loading: false }),
      (error: unknown) => {
        if (!controller.signal.aborted) {
          setState({ error, loading: false });
        }
      },
    );
    return () => controller.abort();
  }, deps);

  return state;
}
