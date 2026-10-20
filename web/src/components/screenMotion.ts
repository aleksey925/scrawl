import { createContext, useContext, useLayoutEffect, type RefObject } from 'react';
import { useLocation, useNavigationType } from 'react-router';

import { layoutBreakpoints, maxWidthQuery } from '../theme';

type Motion = 'forward' | 'back' | 'none';

// ScreenReady says whether a page shows the answer of the route it is on. A
// screen keeps the last answer while the next one loads, and the placeholder
// stands in before the first; neither may take the move meant for the screen
// the reader is going to.
export const ScreenReady = createContext(true);

// the move the reader asked for by what they tapped, which the kind of
// navigation alone does not say: the way up the folders pushes an address, and
// a tab is switched to, not moved to
let planned: { pathname: string; motion: Motion } | undefined;

// planMotion names the move the next page at pathname enters with
export function planMotion(pathname: string, motion: Motion): void {
  planned = { pathname, motion };
}

// leaving is a screen swiped away, held off the edge until the next one enters
let leaving: Animation | undefined;

// the longest a swiped screen stays away for a next one that never enters
const leaveHoldMs = 3000;

// motionMs is how long a move takes, none at all for a reader who asked the
// system for less motion
export function motionMs(ms: number): number {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : ms;
}

// leaveScreen moves the page out past the right edge from where a finger left
// it, and keeps it there until the page of the next route enters. It answers
// whether the page got there: a tap, a navigation or a second swipe that
// cancels the move cancels what was to follow it too.
export function leaveScreen(element: HTMLElement, from: number): Promise<boolean> {
  leaving?.cancel();
  const animation = element.animate([{ transform: `translateX(${from}px)` }, { transform: 'translateX(100%)' }], {
    duration: motionMs(200),
    easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
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

// the location the last page entered for; undefined until the first page is
// drawn, which the app opened on and which enters with no move
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
    return 'back';
  }
  return navigation === 'PUSH' ? 'forward' : 'none';
}

function moves(): boolean {
  return window.matchMedia(`(hover: none) and ${maxWidthQuery(layoutBreakpoints.phone)}`).matches;
}

// useScreenEnter moves a page in the way a phone app moves a screen in: from
// the right for a screen opened, from the left for one gone back to. It runs
// once per navigation, when the page first shows the answer of its route.
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
    if (first || motion === 'none' || ref.current === null || !moves()) {
      return;
    }
    const from = motion === 'forward' ? offset : `-${offset}`;
    ref.current.animate([{ transform: `translateX(${from})`, opacity: 0 }, { transform: 'none', opacity: 1 }], {
      duration: motionMs(enterMs),
      easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
    });
  }, [ready, location.key]);
}
