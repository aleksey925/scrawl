import { createContext, useContext, useLayoutEffect, type RefObject } from 'react';
import { useLocation, useNavigationType } from 'react-router';

import { layoutBreakpoints, maxWidthQuery } from '../theme';

type Motion = 'forward' | 'back' | 'none';

// ScreenReady says whether a page shows the answer of the route it is on. A
// screen keeps the last answer while the next one loads, and the placeholder
// stands in before the first; neither may take the move meant for the screen
// the reader is going to.
export const ScreenReady = createContext(true);

// the move the reader asked for by what they tapped: the way up pushes an
// address, and a tab is switched to, not moved to
let planned: { pathname: string; motion: Motion } | undefined;

// planMotion names the move the next page at pathname enters with
export function planMotion(pathname: string, motion: Motion): void {
  planned = { pathname, motion };
}

// leaving is a screen swiped away, held off the edge until the next one enters
let leaving: Animation | undefined;

// the longest a swiped screen stays away for a next one that never enters
const leaveHoldMs = 3000;

// a screen moves on screenEasing; a lifted card and a menu grow on springEasing,
// which overshoots a little
const screenEasing = 'cubic-bezier(0.2, 0.8, 0.2, 1)';
export const springEasing = 'cubic-bezier(0.2, 0.9, 0.3, 1.15)';
// swipeEndMs is how long a swiped page takes to leave or to settle back
const swipeEndMs = 200;
// a released page is never sent off faster than this, however fast the flick
const minReleaseMs = 120;
// the steepest start of the release curve, as a multiple of its average speed
const maxReleaseSlope = 4;

interface Release {
  duration: number;
  easing: string;
}

// releaseMotion carries a page the last distance px on from the speed the
// finger let it go at, in px/ms toward where it is going: one curve for every
// release sped a slow finger's page up the moment it was let go
export function releaseMotion(distance: number, speed: number): Release {
  const toward = Math.max(0, speed);
  const duration =
    distance <= 0 || toward * swipeEndMs <= maxReleaseSlope * distance
      ? swipeEndMs
      : Math.max(minReleaseMs, (maxReleaseSlope * distance) / toward);
  const slope = distance <= 0 ? 1 : Math.min(maxReleaseSlope, Math.max(1, (toward * duration) / distance));
  return { duration: motionMs(duration), easing: `cubic-bezier(0.25, ${(0.25 * slope).toFixed(3)}, 0.25, 1)` };
}

// standalone is an app opened from the home screen of an iPhone, where the way
// back is the app's own swipe. A tab of Safari has a swipe back of its own, which
// draws the page gone back to under the finger: a swipe of ours there went back
// a second time, and a move of ours after Safari's shook the page.
export function standalone(): boolean {
  return (navigator as { standalone?: boolean }).standalone === true;
}

// motionMs is how long a move takes, none at all for a reader who asked the
// system for less motion
export function motionMs(ms: number): number {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : ms;
}

// leaveScreen moves the page out past the right edge from where a finger left
// it, and keeps it there until the page of the next route enters. It answers
// whether the page got there: a tap, a navigation or a second swipe that
// cancels the move cancels what was to follow it too.
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
    return standalone() ? 'back' : 'none';
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
    const element = ref.current;
    const duration = motionMs(enterMs);
    if (first || motion === 'none' || element === null || !moves() || duration === 0) {
      return;
    }
    const start = { transform: `translateX(${motion === 'forward' ? offset : `-${offset}`})`, opacity: '0' };
    // held inline too: WebKit paints a page put in this frame once at rest before
    // the move takes it, and the page then jumped back to where the move starts
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
