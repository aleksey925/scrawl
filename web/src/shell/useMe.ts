import { useCallback, useEffect, useRef, useState } from 'react';

import { api } from '../api/client';
import { ApiError } from '../api/errors';
import type { MeResponse } from '../api/types';
import { mountBase } from '../mount';
import { confirmOnline, isOnline, onServerBack } from '../offline/connection';
import { meAnswered } from '../offline/copy';
import { releaseAnswered } from '../offline/register';

const meRefreshMs = 60_000;
const pushPollMs = 2_000;
const retryPollMs = 5_000;
const meTimeoutMs = 30_000;

export interface MeState {
  me: MeResponse | undefined;
  refreshMe: () => void;
}

async function leaveGoneSpace(): Promise<void> {
  const here = `${mountBase()}/`;
  const spaces = await api.spaces().catch(() => []);
  const other = spaces.find((entry) => entry.url !== here);
  if (other !== undefined) {
    window.location.replace(other.url);
  }
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
        meAnswered();
        releaseAnswered(res.version);
        if (generation.current === mine) {
          setMe(res);
        }
      })
      .catch((error: unknown) => {
        if (error instanceof ApiError && error.status === 404 && !isOnline()) {
          void leaveGoneSpace();
        }
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
