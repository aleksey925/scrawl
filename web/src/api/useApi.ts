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

// responses is what a screen paints from before its own request has answered.
// A route swap unmounts the component that held the last answer - a note to the
// folder above it is two different screens - so without this the app blanks on
// exactly the navigations a reader makes most.
//
// It is deliberately dumb: no timers, no refcounts, cleared whole by any write.
// The revalidation right behind it is what keeps it honest, so the only thing
// it must never do is grow without a bound.
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

// forgetResponses drops every cached answer. Every mutation calls it: a save, a
// rename or a delete can change any of them, and the cheapest correct rule is
// to keep none of it rather than to reason about which.
export function forgetResponses(): void {
  responses.clear();
}

// useApi runs a request and keeps an answer on screen while the next one is on
// its way - the cached one for this key if there is one, otherwise the one this
// screen showed a moment ago. That is the whole difference from the obvious
// version, and it is the difference between a page that swaps and a page that
// blinks: the tree, the note and every control hang off one of these, so
// clearing the data here blanked the entire window on every click.
//
// An error does replace the data, because there is nothing honest to keep
// showing once what is on screen is known to be wrong.
export function useApi<T>(
  run: (signal: AbortSignal) => Promise<T>,
  deps: DependencyList,
  key?: string,
): AsyncState<T> {
  const [state, setState] = useState<AsyncState<T>>(() => ({
    data: key === undefined ? undefined : (responses.get(key) as T | undefined),
    loading: true,
  }));

  useEffect(() => {
    const controller = new AbortController();
    const cached = key === undefined ? undefined : (responses.get(key) as T | undefined);
    setState((prev) => ({ data: cached ?? prev.data, loading: true }));
    run(controller.signal).then(
      (data) => {
        if (key !== undefined) {
          remember(key, data);
        }
        setState({ data, loading: false });
      },
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
