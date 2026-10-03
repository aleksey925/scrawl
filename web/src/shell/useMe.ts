import { useCallback, useEffect, useRef, useState } from 'react';

import { api } from '../api/client';
import type { MeResponse } from '../api/types';

// meRefreshMs is how long the app may believe a state nobody caused. The
// server-side rhythm is the pull interval, minutes at best, so a minute here is
// already finer than the thing being watched.
const meRefreshMs = 60_000;

export interface MeState {
  me: MeResponse | undefined;
  refreshMe: () => void;
}

// useMe holds the project state and keeps it fresh without the reader.
//
// It does not go through useApi, which clears its data before every request:
// canWrite requires me to be defined, so an interval there would flash every
// write control and every badge off once a tick. This one never replaces a good
// answer with undefined.
//
// Three things change the state and only one of them is a request: a save whose
// push failed answers on the spot, while a background Sync that failed and one
// that succeeded happen with nothing in flight. That is what the interval is
// for, and it is why the person who looks at the editor for twenty minutes
// still hears about it.
export function useMe(): MeState {
  const [me, setMe] = useState<MeResponse | undefined>(undefined);

  // every start takes the next generation and aborts the one in flight, so an
  // older clean response arriving after a newer failed one cannot erase the
  // warning. Without it the state flickers instead of settling.
  const generation = useRef(0);
  const inFlight = useRef<AbortController | undefined>(undefined);

  const load = useCallback((background: boolean) => {
    generation.current += 1;
    const mine = generation.current;
    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;

    api
      .me({ signal: controller.signal, background })
      .then((res) => {
        if (generation.current === mine) {
          setMe(res);
        }
      })
      .catch(() => {
        // a failed read of the state is not a state: the last good answer
        // stands, and the next tick tries again
      });
  }, []);

  const refreshMe = useCallback(() => load(false), [load]);

  useEffect(() => {
    load(false);

    const tick = (): void => {
      // a tab left open all night polls nothing
      if (!document.hidden) {
        load(true);
      }
    };
    const timer = window.setInterval(tick, meRefreshMs);

    // coming back to a tab is the one moment a stale state is most visible
    const onVisible = (): void => {
      if (!document.hidden) {
        load(true);
      }
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      inFlight.current?.abort();
    };
  }, [load]);

  return { me, refreshMe };
}
