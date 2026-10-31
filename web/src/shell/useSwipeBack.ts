import { useEffect, useRef } from 'react';

import { leaveScreen, releaseMotion, standalone } from '../components/screenMotion';

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
  element?: HTMLElement;
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
      'dialog[open], .mantine-Modal-content, .mantine-Drawer-content, .mantine-Menu-dropdown, .mantine-Popover-dropdown',
    ) !== null
  );
}

function entryKey(): string | undefined {
  return (window.history.state as { key?: string } | null)?.key;
}

function screen(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-screen]');
}

function clearDrag(element: HTMLElement): void {
  element.style.transform = '';
  element.style.willChange = '';
}

function settle(element: HTMLElement, from: number, speed: number): void {
  clearDrag(element);
  element.animate([{ transform: `translateX(${from}px)` }, { transform: 'none' }], releaseMotion(from, speed));
}

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

    const drop = (): void => {
      const ended = track;
      track = undefined;
      if (ended?.element !== undefined) {
        settle(ended.element, ended.dx, 0);
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
      if (track.element === undefined) {
        const element = screen();
        if (element === null) {
          track = undefined;
          return;
        }
        if (dx < startPx) {
          return;
        }
        element.style.willChange = 'transform';
        track.element = element;
      }
      track.dx = dx;
      const recent = track.samples.filter((point) => event.timeStamp - point.at <= flickWindowMs);
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
      const speed = speedOf(ended.samples, event.timeStamp);
      const done = speed > flickPxPerMs || (ended.dx > element.offsetWidth * completeShare && speed > -flickPxPerMs);
      if (!done) {
        settle(element, ended.dx, -speed);
        return;
      }
      clearDrag(element);
      const from = entryKey();
      void leaveScreen(element, ended.dx, speed).then((gone) => {
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
