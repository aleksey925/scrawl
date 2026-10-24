import { useCallback, useEffect, useRef, useState } from 'react';

import { api } from '../api/client';
import type { MeResponse } from '../api/types';

const meRefreshMs = 60_000;

export interface MeState {
  me: MeResponse | undefined;
  refreshMe: () => void;
}

export function useMe(): MeState {
  const [me, setMe] = useState<MeResponse | undefined>(undefined);

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
      });
  }, []);

  const refreshMe = useCallback(() => load(false), [load]);

  useEffect(() => {
    load(false);

    const tick = (): void => {
      if (!document.hidden) {
        load(true);
      }
    };
    const timer = window.setInterval(tick, meRefreshMs);

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
