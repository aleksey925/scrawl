import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router';

import {
  iosHomeScreenApp, leavingScreen, releaseMotion, screenHidden, sendOff, takeScreen, type Drag,
} from '../components/screenMotion';

const edgePx = 24;
const decidePx = 6;
const startPx = 8;
const completeShare = 0.35;
const flickPxPerMs = 0.4;
const flickWindowMs = 100;
const prefetchKeepMs = 3000;

interface Sample {
  dx: number;
  at: number;
}

interface Track {
  entry: string;
  x: number;
  y: number;
  dx: number;
  samples: Sample[];
  across: boolean;
  taken?: Drag;
  giveUp?: () => void;
}

function speedOf(samples: Sample[], now: number): number {
  const recent = samples.filter((point) => now - point.at <= flickWindowMs);
  const first = recent[0];
  const last = recent[recent.length - 1];
  if (first === undefined || last === undefined || last.at === first.at) {
    return 0;
  }
  return (last.dx - first.dx) / (last.at - first.at);
}

function covered(): boolean {
  return (
    document.querySelector(
      'dialog[open], .mantine-Modal-content, .mantine-Drawer-content, .mantine-Popover-dropdown, [role="menu"]',
    ) !== null
  );
}

function screen(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-screen]');
}

function clearDrag(element: HTMLElement): void {
  element.style.transform = '';
  element.style.willChange = '';
}

function catchUp(track: Track, element: HTMLElement, dx: number): number {
  const offset = Math.max(0, new DOMMatrix(getComputedStyle(element).transform).m41 - dx);
  track.x -= offset;
  track.samples = track.samples.map((point) => ({ dx: point.dx + offset, at: point.at }));
  return dx + offset;
}

function afterPaint(run: () => void): void {
  window.requestAnimationFrame(() => {
    window.setTimeout(run);
  });
}

function detached(handler: (event: TouchEvent) => void): (event: Event) => void {
  return (event) => {
    if (event.currentTarget instanceof Node && !event.currentTarget.isConnected) {
      handler(event as TouchEvent);
    }
  };
}

function settle({ dx: from, giveUp }: Track, { element, release }: Drag, speed: number): void {
  giveUp?.();
  clearDrag(element);
  const animation = element.animate([{ transform: `translateX(${from}px)` }, { transform: 'none' }], releaseMotion(from, speed));
  release(animation.finished);
}

export function useSwipeBack(goBack: (() => void) | null, prepare?: () => () => void): void {
  const goBackRef = useRef(goBack);
  const prepareRef = useRef(prepare);
  const { key } = useLocation();
  const entryRef = useRef(key);
  useEffect(() => {
    goBackRef.current = goBack;
    prepareRef.current = prepare;
    entryRef.current = key;
  });

  useEffect(() => {
    if (!iosHomeScreenApp()) {
      return undefined;
    }
    let track: Track | undefined;
    let origin: EventTarget | undefined;

    const unwatch = (): void => {
      origin?.removeEventListener('touchmove', onLostMove);
      origin?.removeEventListener('touchend', onLostEnd);
      origin?.removeEventListener('touchcancel', onLostCancel);
      origin = undefined;
    };

    const watch = (target: EventTarget | null): void => {
      unwatch();
      if (target === null) {
        return;
      }
      origin = target;
      target.addEventListener('touchmove', onLostMove, { passive: false });
      target.addEventListener('touchend', onLostEnd);
      target.addEventListener('touchcancel', onLostCancel);
    };

    const drop = (): void => {
      unwatch();
      const ended = track;
      track = undefined;
      if (ended?.taken !== undefined) {
        settle(ended, ended.taken, 0);
      }
    };

    const onStart = (event: TouchEvent): void => {
      if (track?.taken !== undefined) {
        drop();
        return;
      }
      const touch = event.touches[0];
      track =
        event.touches.length === 1 &&
        touch !== undefined &&
        touch.clientX <= edgePx &&
        goBackRef.current !== null &&
        !leavingScreen() &&
        !screenHidden() &&
        !covered()
          ? {
              entry: entryRef.current,
              x: touch.clientX,
              y: touch.clientY,
              dx: 0,
              samples: [{ dx: 0, at: event.timeStamp }],
              across: false,
            }
          : undefined;
      if (track === undefined) {
        unwatch();
      } else {
        watch(event.target);
      }
    };

    const onMove = (event: TouchEvent): void => {
      const touch = event.touches[0];
      if (track === undefined || touch === undefined) {
        return;
      }
      const moved = touch.clientX - track.x;
      let dx = Math.max(0, moved);
      const dy = Math.abs(touch.clientY - track.y);
      if (!track.across) {
        const decided = Math.hypot(moved, dy) >= decidePx;
        if (decided && dy > moved) {
          track = undefined;
          return;
        }
        track.across = decided;
      }
      event.preventDefault();
      if (track.taken === undefined) {
        const element = screen();
        if (element === null) {
          track = undefined;
          return;
        }
        if (dx < startPx) {
          return;
        }
        dx = catchUp(track, element, dx);
        track.taken = takeScreen(element);
        element.style.willChange = 'transform';
        track.giveUp = prepareRef.current?.();
      }
      track.dx = dx;
      const recent = track.samples.filter((point) => event.timeStamp - point.at <= flickWindowMs);
      track.samples = [...recent, { dx, at: event.timeStamp }];
      track.taken.element.style.transform = `translateX(${dx}px)`;
    };

    const onEnd = (event: TouchEvent): void => {
      unwatch();
      const ended = track;
      track = undefined;
      const taken = ended?.taken;
      if (ended === undefined || taken === undefined) {
        return;
      }
      const { element, release } = taken;
      const speed = speedOf(ended.samples, event.timeStamp);
      const done = speed > flickPxPerMs || (ended.dx > element.offsetWidth * completeShare && speed > -flickPxPerMs);
      const back = goBackRef.current;
      if (!done || back === null || entryRef.current !== ended.entry) {
        settle(ended, taken, -speed);
        return;
      }
      clearDrag(element);
      sendOff(element, ended.dx, speed);
      release();
      if (ended.giveUp !== undefined) {
        window.setTimeout(ended.giveUp, prefetchKeepMs);
      }
      afterPaint(() => {
        if (entryRef.current === ended.entry) {
          back();
        }
      });
    };

    const onLostMove = detached(onMove);
    const onLostEnd = detached(onEnd);
    const onLostCancel = detached(drop);

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
