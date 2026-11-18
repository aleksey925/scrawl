import { createContext, useContext, useLayoutEffect, type RefObject } from 'react';
import { useLocation, useNavigationType } from 'react-router';

import { motionMs, noteEntering } from '../motion';
import { scopeIds } from '../reader/diagramSvg';
import { layoutBreakpoints, maxWidthQuery } from '../theme';

type Motion = 'forward' | 'back' | 'none';

export const ScreenReady = createContext(true);

let planned: { pathname: string; motion: Motion } | undefined;

export function planMotion(pathname: string, motion: Motion): void {
  planned = { pathname, motion };
}

let ghost: HTMLElement | undefined;

let hidden: { element: HTMLElement; timer: number } | undefined;

const hideHoldMs = 3000;

const screenEasing = 'cubic-bezier(0.25, 0.46, 0.45, 0.94)';
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

function reveal(): void {
  if (hidden !== undefined) {
    window.clearTimeout(hidden.timer);
    hidden.element.style.visibility = '';
    hidden = undefined;
  }
}

function stripMarks(copy: HTMLElement): void {
  const diagrams = Array.from(copy.querySelectorAll<SVGSVGElement>('svg[id]')).filter(
    (svg) => svg.parentElement?.closest('svg') === null,
  );
  for (const svg of diagrams) {
    scopeIds(svg, `leaving-${svg.id}`);
  }
  for (const node of [copy, ...copy.querySelectorAll<HTMLElement>('[id], [data-testid], [data-screen]')]) {
    if (!diagrams.some((svg) => svg.contains(node))) {
      node.removeAttribute('id');
    }
    node.removeAttribute('data-testid');
    node.removeAttribute('data-screen');
  }
}

export function sendOff(element: HTMLElement, from: number, speed: number): void {
  reveal();
  const box = element.getBoundingClientRect();
  const copy = element.cloneNode(true) as HTMLElement;
  stripMarks(copy);
  Object.assign(copy.style, {
    position: 'absolute',
    top: `${box.top}px`,
    left: `${box.left}px`,
    width: `${box.width}px`,
    margin: '0',
  });
  const cover = document.createElement('div');
  cover.inert = true;
  cover.dataset.leaving = 'true';
  Object.assign(cover.style, {
    position: 'fixed',
    top: '0',
    left: '0',
    width: '100%',
    height: '100%',
    overflow: 'hidden',
    background: 'var(--scrawl-bg)',
    zIndex: '90',
    transform: `translateX(${from}px)`,
    willChange: 'transform',
  });
  cover.append(copy);
  element.after(cover);
  element.style.visibility = 'hidden';
  hidden = { element, timer: window.setTimeout(reveal, hideHoldMs) };
  ghost = cover;
  const animation = cover.animate([{ transform: `translateX(${from}px)` }, { transform: 'translateX(100%)' }], {
    ...releaseMotion(box.width - from, speed),
    fill: 'forwards',
  });
  const remove = (): void => {
    cover.remove();
    if (ghost === cover) {
      ghost = undefined;
    }
  };
  void animation.finished.then(remove, remove);
  window.setTimeout(remove, hideHoldMs);
}

export function leavingScreen(): boolean {
  return ghost !== undefined;
}

export function takeScreen(element: HTMLElement): void {
  for (const animation of element.getAnimations()) {
    animation.finish();
  }
}

let enteredFor: string | undefined;
let offScreen = false;

export function useOffScreen(): void {
  useLayoutEffect(() => {
    offScreen = true;
  }, []);
}

const enterMs = 300;
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
    if (!ready) {
      return;
    }
    reveal();
    if (enteredFor === location.key && !offScreen) {
      return;
    }
    const first = enteredFor === undefined;
    enteredFor = location.key;
    offScreen = false;
    const motion = motionOf(location.pathname, navigation);
    const element = ref.current;
    const duration = motionMs(enterMs);
    if (first || motion === 'none' || element === null || !moves() || duration === 0) {
      return;
    }
    const start =
      motion === 'forward' ? { transform: `translateX(${offset})`, opacity: '0' } : { transform: `translateX(-${offset})`, opacity: '1' };
    Object.assign(element.style, start);
    const animation = element.animate([start, { transform: 'none', opacity: '1' }], {
      duration,
      easing: screenEasing,
      fill: 'forwards',
    });
    const done = (): void => {
      if (element.style.transform === start.transform) {
        element.style.transform = '';
      }
      element.style.opacity = '';
      animation.cancel();
    };
    noteEntering(animation.finished.then(done, done));
  }, [ready, location.key]);
}
