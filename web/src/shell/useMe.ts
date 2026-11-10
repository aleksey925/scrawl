import { useCallback, useEffect, useRef, useState } from 'react';

import { api } from '../api/client';
import type { MeResponse } from '../api/types';
import { confirmOnline, onServerBack } from '../offline/connection';
import { meAnswered } from '../offline/copy';

const meRefreshMs = 60_000;
const pushPollMs = 2_000;
const retryPollMs = 5_000;
const meTimeoutMs = 30_000;

export interface MeState {
  me: MeResponse | undefined;
  refreshMe: () => void;
}

export function useMe(): MeState {
  const [me, setMe] = useState<MeResponse | undefined>(undefined);
  const [answers, setAnswers] = useState(0);

  const generation = useRef(0);
  const inFlight = useRef<AbortController | undefined>(undefined);

  const load = useCallback((background: boolean) => {
    generation.current += 1;
    const mine = generation.current;
    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;
    const timeout = window.setTimeout(() => controller.abort(), meTimeoutMs);

    api
      .me({ signal: controller.signal, background })
      .then((res) => {
        confirmOnline();
        meAnswered(res);
        if (generation.current === mine) {
          setMe(res);
        }
      })
      .catch(() => {
      })
      .finally(() => {
        window.clearTimeout(timeout);
        if (inFlight.current === controller) {
          inFlight.current = undefined;
        }
        if (generation.current === mine) {
          setAnswers((seen) => seen + 1);
        }
      });
  }, []);

  const refreshMe = useCallback(() => load(false), [load]);

  useEffect(() => onServerBack(refreshMe), [refreshMe]);

  useEffect(() => {
    load(false);

    const onVisible = (): void => {
      if (!document.hidden) {
        load(true);
      }
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      inFlight.current?.abort();
    };
  }, [load]);

  const wait = pollAfter(me);
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (!document.hidden && inFlight.current === undefined) {
        load(true);
      }
    }, wait);
    return () => window.clearInterval(timer);
  }, [wait, answers, load]);

  return { me, refreshMe };
}

function pollAfter(me: MeResponse | undefined): number {
  if (me?.space.pushing === true) {
    return pushPollMs;
  }
  if (me?.space.retrying === true) {
    return retryPollMs;
  }
  return meRefreshMs;
}
