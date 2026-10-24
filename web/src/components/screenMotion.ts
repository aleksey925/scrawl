import { createContext, useContext, useLayoutEffect, type RefObject } from 'react';
import { useLocation, useNavigationType } from 'react-router';

import { layoutBreakpoints, maxWidthQuery } from '../theme';

type Motion = 'forward' | 'back' | 'none';

export const ScreenReady = createContext(true);

let planned: { pathname: string; motion: Motion } | undefined;

export function planMotion(pathname: string, motion: Motion): void {
  planned = { pathname, motion };
}

let leaving: Animation | undefined;

const leaveHoldMs = 3000;

const screenEasing = 'cubic-bezier(0.2, 0.8, 0.2, 1)';
export const springEasing = 'cubic-bezier(0.2, 0.9, 0.3, 1.15)';
const swipeEndMs = 200;
const minReleaseMs = 120;
const maxReleaseSlope = 4;

interface Release {
  duration: number;
  easing: string;
}

export function releaseMotion(distance: number, speed: number): Release {
  const toward = Math.max(0, speed);
  const duration =
    distance <= 0 || toward * swipeEndMs <= maxReleaseSlope * distance
      ? swipeEndMs
      : Math.max(minReleaseMs, (maxReleaseSlope * distance) / toward);
  const slope = distance <= 0 ? 1 : Math.min(maxReleaseSlope, Math.max(1, (toward * duration) / distance));
  return { duration: motionMs(duration), easing: `cubic-bezier(0.25, ${(0.25 * slope).toFixed(3)}, 0.25, 1)` };
}

export function standalone(): boolean {
  return (navigator as { standalone?: boolean }).standalone === true;
}

export function motionMs(ms: number): number {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : ms;
}

export function leaveScreen(element: HTMLElement, from: number, speed: number): Promise<boolean> {
  leaving?.cancel();
  const animation = element.animate([{ transform: `translateX(${from}px)` }, { transform: 'translateX(100%)' }], {
    ...releaseMotion(element.offsetWidth - from, speed),
    fill: 'forwards',
  });
  leaving = animation;
  window.setTimeout(() => {
    if (leaving === animation) {
      animation.cancel();
      leaving = undefined;
    }
  }, leaveHoldMs);
  return animation.finished.then(
    () => true,
    () => false,
  );
}

let enteredFor: string | undefined;

const enterMs = 280;
const offset = '28%';

function motionOf(pathname: string, navigation: string): Motion {
  const asked = planned?.pathname === pathname ? planned.motion : undefined;
  planned = undefined;
  if (asked !== undefined) {
    return asked;
  }
  if (navigation === 'POP') {
    return standalone() ? 'back' : 'none';
  }
  return navigation === 'PUSH' ? 'forward' : 'none';
}

function moves(): boolean {
  return window.matchMedia(`(hover: none) and ${maxWidthQuery(layoutBreakpoints.phone)}`).matches;
}

export function useScreenEnter(ref: RefObject<HTMLElement | null>): void {
  const ready = useContext(ScreenReady);
  const location = useLocation();
  const navigation = useNavigationType();

  useLayoutEffect(() => {
    if (!ready || enteredFor === location.key) {
      return;
    }
    const first = enteredFor === undefined;
    enteredFor = location.key;
    leaving?.cancel();
    leaving = undefined;
    const motion = motionOf(location.pathname, navigation);
    const element = ref.current;
    const duration = motionMs(enterMs);
    if (first || motion === 'none' || element === null || !moves() || duration === 0) {
      return;
    }
    const start = { transform: `translateX(${motion === 'forward' ? offset : `-${offset}`})`, opacity: '0' };
    Object.assign(element.style, start);
    const animation = element.animate([start, { transform: 'none', opacity: '1' }], {
      duration,
      easing: screenEasing,
      fill: 'forwards',
    });
    const done = (): void => {
      element.style.transform = '';
      element.style.opacity = '';
      animation.cancel();
    };
    void animation.finished.then(done, done);
  }, [ready, location.key]);
}
