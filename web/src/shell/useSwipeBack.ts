import { useEffect, useRef } from 'react';

import { leaveScreen, motionMs } from '../components/screenMotion';

// how far from the left edge a finger has to land to start the swipe
const edgePx = 24;
// how far it travels before it counts as a swipe and not a tap or a scroll
const startPx = 8;
// past this part of the width, or faster than this, the swipe goes back
const completeShare = 0.35;
const flickPxPerMs = 0.4;
// the speed of the release is read over the last stretch of the movement
const flickWindowMs = 100;

interface Sample {
  dx: number;
  at: number;
}

interface Track {
  x: number;
  y: number;
  dx: number;
  samples: Sample[];
  // the page the finger drags, once the drag has started
  element?: HTMLElement;
}

// speedOf is how fast the finger moved over the last stretch before it lifted
function speedOf(samples: Sample[], now: number): number {
  const recent = samples.filter((sample) => now - sample.at <= flickWindowMs);
  const first = recent[0];
  const last = recent[recent.length - 1];
  if (first === undefined || last === undefined || last.at === first.at) {
    return 0;
  }
  return (last.dx - first.dx) / (last.at - first.at);
}

// standalone is an app opened from the home screen of an iPhone. In a tab of
// Safari the browser has its own swipe back, and both would go back once each.
function standalone(): boolean {
  return (navigator as { standalone?: boolean }).standalone === true;
}

// covered says something is open over the page, which the swipe must not move
// from under it: a dialog, a sheet, a menu, the search or the picture viewer
function covered(): boolean {
  return (
    document.querySelector(
      'dialog[open], .mantine-Modal-content, .mantine-Drawer-content, .mantine-Menu-dropdown, .mantine-Popover-dropdown',
    ) !== null
  );
}

// entryKey names the entry of the history the app is on, which the router keeps
// in the history's state
function entryKey(): string | undefined {
  return (window.history.state as { key?: string } | null)?.key;
}

function screen(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-screen]');
}

function settle(element: HTMLElement, from: number): void {
  element.style.transform = '';
  element.animate([{ transform: `translateX(${from}px)` }, { transform: 'none' }], {
    duration: motionMs(200),
    easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
  });
}

// useSwipeBack lets a finger drag the page off to the right from the left edge
// of the screen and go back, the way an iPhone app goes back. goBack is null
// where there is nowhere to go.
export function useSwipeBack(goBack: (() => void) | null): void {
  const goBackRef = useRef(goBack);
  useEffect(() => {
    goBackRef.current = goBack;
  });

  useEffect(() => {
    if (!standalone()) {
      return undefined;
    }
    let track: Track | undefined;

    // drop gives up the drag and puts the page back where it was: a second
    // finger, a touch the system took, or the page going away mid-drag
    const drop = (): void => {
      const ended = track;
      track = undefined;
      if (ended?.element !== undefined) {
        settle(ended.element, ended.dx);
      }
    };

    const onStart = (event: TouchEvent): void => {
      if (track?.element !== undefined) {
        drop();
        return;
      }
      const touch = event.touches[0];
      track =
        event.touches.length === 1 && touch !== undefined && touch.clientX <= edgePx && goBackRef.current !== null && !covered()
          ? { x: touch.clientX, y: touch.clientY, dx: 0, samples: [] }
          : undefined;
    };

    const onMove = (event: TouchEvent): void => {
      const touch = event.touches[0];
      if (track === undefined || touch === undefined) {
        return;
      }
      const dx = Math.max(0, touch.clientX - track.x);
      const dy = Math.abs(touch.clientY - track.y);
      if (track.element === undefined) {
        const element = screen();
        if (element === null || (dy > startPx && dy > dx)) {
          track = undefined;
          return;
        }
        if (dx < startPx) {
          return;
        }
        track.element = element;
      }
      event.preventDefault();
      track.dx = dx;
      const recent = track.samples.filter((sample) => event.timeStamp - sample.at <= flickWindowMs);
      track.samples = [...recent, { dx, at: event.timeStamp }];
      track.element.style.transform = `translateX(${dx}px)`;
    };

    const onEnd = (event: TouchEvent): void => {
      const ended = track;
      track = undefined;
      const element = ended?.element;
      if (ended === undefined || element === undefined) {
        return;
      }
      const done = ended.dx > window.innerWidth * completeShare || speedOf(ended.samples, event.timeStamp) > flickPxPerMs;
      if (!done) {
        settle(element, ended.dx);
        return;
      }
      element.style.transform = '';
      const from = entryKey();
      void leaveScreen(element, ended.dx).then((gone) => {
        // a tab tapped while the page was leaving moved the history on, and its
        // screen may still be loading, too late to have cancelled the leave
        if (gone && entryKey() === from) {
          goBackRef.current?.();
        }
      });
    };

    document.addEventListener('touchstart', onStart, { passive: true });
    document.addEventListener('touchmove', onMove, { passive: false });
    document.addEventListener('touchend', onEnd);
    document.addEventListener('touchcancel', drop);
    return () => {
      document.removeEventListener('touchstart', onStart);
      document.removeEventListener('touchmove', onMove);
      document.removeEventListener('touchend', onEnd);
      document.removeEventListener('touchcancel', drop);
      drop();
    };
  }, []);
}
