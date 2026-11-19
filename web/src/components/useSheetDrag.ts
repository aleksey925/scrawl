import { useEffect, useRef, useState, type RefCallback } from 'react';

import { motionMs } from '../motion';

const slopPx = 6;
const closeShare = 0.25;
const flickPxPerMs = 0.5;
const flickWindowMs = 100;
const settleMs = 220;

interface Touched {
  y: number;
  x: number;
  scroller: HTMLElement | null;
}

function scrollerOf(target: EventTarget | null, root: HTMLElement): HTMLElement | null {
  let element = target instanceof Element ? target : null;
  while (element !== null) {
    if (element instanceof HTMLElement && element.scrollHeight > element.clientHeight) {
      const overflow = getComputedStyle(element).overflowY;
      if (overflow === 'auto' || overflow === 'scroll') {
        return element;
      }
    }
    element = element === root ? null : element.parentElement;
  }
  return null;
}

export function useSheetDrag(opened: boolean, onClose: () => void): RefCallback<HTMLElement> {
  const [node, setNode] = useState<HTMLElement | null>(null);
  const close = useRef(onClose);

  useEffect(() => {
    close.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (opened && node !== null) {
      node.style.translate = '';
      node.style.transition = '';
    }
  }, [opened, node]);

  useEffect(() => {
    if (node === null) {
      return undefined;
    }
    let touched: Touched | undefined;
    let dragging = false;
    let offset = 0;
    let lastY = 0;
    let lastTime = 0;
    let speed = 0;
    let closing: number | undefined;

    const settle = (dismiss: boolean): void => {
      const ms = motionMs(settleMs);
      node.style.transition = `translate ${ms}ms ease-out`;
      node.style.translate = dismiss ? '0 100%' : '';
      if (dismiss) {
        closing = window.setTimeout(() => close.current(), ms);
      }
    };

    const onStart = (event: TouchEvent): void => {
      const touch = event.touches[0];
      if (event.touches.length !== 1 || touch === undefined) {
        if (dragging) {
          settle(false);
        }
        touched = undefined;
        dragging = false;
        return;
      }
      touched = { y: touch.clientY, x: touch.clientX, scroller: scrollerOf(event.target, node) };
      dragging = false;
      offset = 0;
      speed = 0;
      lastY = touch.clientY;
      lastTime = event.timeStamp;
    };

    const onMove = (event: TouchEvent): void => {
      const touch = event.touches[0];
      if (touched === undefined || touch === undefined) {
        return;
      }
      const down = touch.clientY - touched.y;
      if (!dragging) {
        const across = Math.abs(touch.clientX - touched.x);
        if (Math.max(Math.abs(down), across) < slopPx) {
          return;
        }
        const scrolled = touched.scroller !== null && touched.scroller.scrollTop > 0;
        if (down <= 0 || across > down || scrolled) {
          touched = undefined;
          return;
        }
        dragging = true;
        node.style.transition = 'none';
      }
      event.preventDefault();
      offset = Math.max(0, down);
      node.style.translate = `0 ${offset}px`;
      const elapsed = event.timeStamp - lastTime;
      if (elapsed > 0) {
        speed = (touch.clientY - lastY) / elapsed;
      }
      lastY = touch.clientY;
      lastTime = event.timeStamp;
    };

    const finish = (dismiss: boolean): void => {
      if (dragging) {
        settle(dismiss);
      }
      touched = undefined;
      dragging = false;
    };
    const onEnd = (event: TouchEvent): void => {
      const flicked = event.timeStamp - lastTime <= flickWindowMs && speed > flickPxPerMs;
      finish(offset > node.offsetHeight * closeShare || flicked);
    };
    const onCancel = (): void => finish(false);

    node.addEventListener('touchstart', onStart, { passive: true });
    node.addEventListener('touchmove', onMove, { passive: false });
    node.addEventListener('touchend', onEnd);
    node.addEventListener('touchcancel', onCancel);
    return () => {
      node.removeEventListener('touchstart', onStart);
      node.removeEventListener('touchmove', onMove);
      node.removeEventListener('touchend', onEnd);
      node.removeEventListener('touchcancel', onCancel);
      window.clearTimeout(closing);
    };
  }, [node]);

  return setNode;
}
