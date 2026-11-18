import { useEffect, useRef } from 'react';

import { leavingScreen, releaseMotion, sendOff, standalone, takeScreen, type Drag } from '../components/screenMotion';

const edgePx = 24;
const decidePx = 6;
const startPx = 8;
const completeShare = 0.35;
const flickPxPerMs = 0.4;
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
  across: boolean;
  taken?: Drag;
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

function settle({ element, release }: Drag, from: number, speed: number): void {
  clearDrag(element);
  const animation = element.animate([{ transform: `translateX(${from}px)` }, { transform: 'none' }], releaseMotion(from, speed));
  release(animation.finished);
}

export function useSwipeBack(goBack: (() => void) | null, prepare?: () => void): void {
  const goBackRef = useRef(goBack);
  const prepareRef = useRef(prepare);
  useEffect(() => {
    goBackRef.current = goBack;
    prepareRef.current = prepare;
  });

  useEffect(() => {
    if (!standalone()) {
      return undefined;
    }
    let track: Track | undefined;

    const drop = (): void => {
      const ended = track;
      track = undefined;
      if (ended?.taken !== undefined) {
        settle(ended.taken, ended.dx, 0);
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
        !covered()
          ? { x: touch.clientX, y: touch.clientY, dx: 0, samples: [], across: false }
          : undefined;
    };

    const onMove = (event: TouchEvent): void => {
      const touch = event.touches[0];
      if (track === undefined || touch === undefined) {
        return;
      }
      const moved = touch.clientX - track.x;
      const dx = Math.max(0, moved);
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
        track.taken = takeScreen(element);
        element.style.willChange = 'transform';
        prepareRef.current?.();
      }
      track.dx = dx;
      const recent = track.samples.filter((point) => event.timeStamp - point.at <= flickWindowMs);
      track.samples = [...recent, { dx, at: event.timeStamp }];
      track.taken.element.style.transform = `translateX(${dx}px)`;
    };

    const onEnd = (event: TouchEvent): void => {
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
      if (!done || back === null) {
        settle(taken, ended.dx, -speed);
        return;
      }
      clearDrag(element);
      sendOff(element, ended.dx, speed);
      release();
      back();
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
