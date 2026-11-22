import { createContext, useContext, useLayoutEffect, type RefObject } from 'react';
import { useLocation, useNavigationType } from 'react-router';

import { iosHomeScreenApp } from '../homeScreen';
import { holdScreen, motionMs, noteEntering } from '../motion';
import { scopeDiagramIds } from '../reader/diagramSvg';
import { findScreenOf } from '../reader/findScreen';
import { decodeFragment } from '../reader/dom';
import { layoutBreakpoints, maxWidthQuery } from '../theme';

import classes from './screenMotion.module.css';

type Motion = 'forward' | 'back' | 'none';

export const ScreenReady = createContext(true);

let planned: { pathname: string; motion: Motion } | undefined;

export function planMotion(pathname: string, motion: Motion): void {
  planned = { pathname, motion };
}

interface Leaving {
  sheet: HTMLElement;
  animation: Animation;
  from: number;
  duration: number;
  easing: string;
}

let leaving: Leaving | undefined;

let swiped = false;

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

function reveal(): void {
  if (hidden !== undefined) {
    window.clearTimeout(hidden.timer);
    hidden.element.style.visibility = '';
    hidden = undefined;
  }
}

export function screenHidden(): boolean {
  return hidden?.element.isConnected === true;
}

function stripMarks(copy: HTMLElement): void {
  const diagrams = scopeDiagramIds(copy, 'leaving');
  for (const node of [copy, ...copy.querySelectorAll<HTMLElement>('[id], [data-testid], [data-screen]')]) {
    if (!diagrams.some((svg) => svg.contains(node))) {
      node.removeAttribute('id');
    }
    node.removeAttribute('data-testid');
    node.removeAttribute('data-screen');
  }
}

interface Scrolled {
  index: number;
  left: number;
  top: number;
}

const sideways = 'pre, table, .table-wrap, .math-display, .math-inline, .md-diagram-view';

function scrolledParts(element: HTMLElement): Scrolled[] {
  const parts: Scrolled[] = [];
  for (const [index, node] of element.querySelectorAll(sideways).entries()) {
    if (node.scrollLeft !== 0 || node.scrollTop !== 0) {
      parts.push({ index, left: node.scrollLeft, top: node.scrollTop });
    }
  }
  return parts;
}

function keepScroll(copy: HTMLElement, parts: Scrolled[]): void {
  if (parts.length === 0) {
    return;
  }
  const nodes = copy.querySelectorAll(sideways);
  for (const { index, left, top } of parts) {
    const node = nodes[index];
    if (node !== undefined) {
      node.scrollLeft = left;
      node.scrollTop = top;
    }
  }
}

export function sendOff(element: HTMLElement, from: number, speed: number): void {
  reveal();
  const box = element.getBoundingClientRect();
  const scrolled = scrolledParts(element);
  const copy = element.cloneNode(true) as HTMLElement;
  stripMarks(copy);
  copy.inert = true;
  const screen = findScreenOf(element) === element;
  Object.assign(copy.style, {
    position: 'absolute',
    left: `${box.left}px`,
    width: `${box.width}px`,
    margin: '0',
  });
  if (screen) {
    Object.assign(copy.style, { height: `${box.height}px`, overflow: 'hidden' });
  }
  const sheet = document.createElement('div');
  sheet.className = classes.sheet ?? '';
  sheet.dataset.leaving = 'true';
  sheet.style.transform = `translateX(${from}px)`;
  sheet.append(copy);
  if (screen) {
    document.body.append(sheet);
  } else {
    element.after(sheet);
  }
  copy.style.top = `${box.top - sheet.getBoundingClientRect().top}px`;
  copy.scrollTop = element.scrollTop;
  keepScroll(copy, scrolled);
  element.style.visibility = 'hidden';
  hidden = { element, timer: window.setTimeout(reveal, hideHoldMs) };
  const timing = releaseMotion(box.width - from, speed);
  const animation = sheet.animate([{ transform: `translateX(${from}px)` }, { transform: 'translateX(100%)' }], {
    ...timing,
    fill: 'forwards',
  });
  leaving = { sheet, animation, from, ...timing };
  swiped = true;
  const held = holdScreen();
  const cap = window.setTimeout(() => animation.cancel(), hideHoldMs);
  const remove = (): void => {
    window.clearTimeout(cap);
    held();
    sheet.remove();
    if (leaving?.sheet === sheet) {
      leaving = undefined;
    }
  };
  void animation.finished.then(remove, remove);
}

export function leavingScreen(): boolean {
  return leaving !== undefined;
}

export interface Drag {
  element: HTMLElement;
  release: (settled?: Promise<unknown>) => void;
}

let drag: Drag | undefined;

export function takeScreen(element: HTMLElement): Drag {
  for (const animation of element.getAnimations()) {
    animation.cancel();
  }
  const held = holdScreen();
  const taken: Drag = {
    element,
    release: (settled) => {
      if (drag === taken) {
        drag = undefined;
      }
      void (settled ?? Promise.resolve()).then(held, held);
    },
  };
  drag = taken;
  return taken;
}

function handToDrag(taken: Drag, element: HTMLElement): void {
  if (taken.element !== element) {
    element.style.transform = taken.element.style.transform;
    element.style.willChange = taken.element.style.willChange;
    taken.element = element;
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
const offsetPercent = 28;

interface Enter {
  start: string;
  duration: number;
  easing: string;
  clock: Animation;
}

function alongLeaving(): Enter | undefined {
  if (leaving === undefined) {
    return undefined;
  }
  if (Number(leaving.animation.currentTime ?? 0) >= leaving.duration) {
    return undefined;
  }
  const behind = leaving.sheet.offsetWidth - leaving.from;
  return {
    start: `translateX(${-Math.round((offsetPercent / 100) * behind)}px)`,
    duration: leaving.duration,
    easing: leaving.easing,
    clock: leaving.animation,
  };
}

function motionOf(pathname: string, navigation: string): Motion {
  const asked = planned !== undefined && decodeFragment(planned.pathname) === decodeFragment(pathname) ? planned.motion : undefined;
  planned = undefined;
  if (asked !== undefined) {
    return asked;
  }
  if (navigation === 'POP') {
    return iosHomeScreenApp() ? 'back' : 'none';
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
    const afterSwipe = swiped;
    swiped = false;
    const motion = motionOf(location.pathname, navigation);
    const element = ref.current;
    if (drag !== undefined && element !== null) {
      handToDrag(drag, element);
      return;
    }
    const duration = motionMs(enterMs);
    if (first || motion === 'none' || element === null || !moves() || duration === 0) {
      return;
    }
    const along = motion === 'back' ? alongLeaving() : undefined;
    if (motion === 'back' && afterSwipe && along === undefined) {
      return;
    }
    const start =
      motion === 'forward'
        ? { transform: `translateX(${offsetPercent}%)`, opacity: '0' }
        : { transform: along?.start ?? `translateX(-${offsetPercent}%)`, opacity: '1' };
    Object.assign(element.style, start);
    const animation = element.animate([start, { transform: 'none', opacity: '1' }], {
      duration: along?.duration ?? duration,
      easing: along?.easing ?? screenEasing,
      fill: 'forwards',
    });
    if (along !== undefined) {
      const { clock } = along;
      const follow = (): void => {
        if (animation.playState !== 'idle' && clock.startTime !== null) {
          animation.startTime = clock.startTime;
        }
      };
      void clock.ready.then(follow, follow);
    }
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
