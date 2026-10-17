import { useCallback, useRef } from 'react';

// how far the pointer travels before the gesture counts as a swipe and not a tap
const swipeMin = 60;

// past this the drag has a direction, and a horizontal one belongs to the panel
// rather than to the list scrolling inside it
const decideAt = 10;

export type SwipeRef = (node: HTMLElement | null) => void;

// useSwipeToClose closes a panel hinged on the left when the pointer is dragged
// back towards that edge. It returns a ref to put on the surface the gesture is
// read from; nothing is armed once the drag ends, so the next tap is a tap.
export function useSwipeToClose(onClose: () => void): SwipeRef {
  const closing = useRef(onClose);
  closing.current = onClose;

  return useCallback((node: HTMLElement | null) => {
    if (node === null) {
      return undefined;
    }

    let startX = 0;
    let startY = 0;
    let tracking = false;
    let horizontal = false;

    const reset = (): void => {
      tracking = false;
      horizontal = false;
    };

    const onDown = (event: PointerEvent): void => {
      if (!event.isPrimary) {
        return;
      }
      startX = event.clientX;
      startY = event.clientY;
      tracking = true;
      horizontal = false;
    };

    const onMove = (event: PointerEvent): void => {
      if (!tracking) {
        return;
      }
      const dx = event.clientX - startX;
      const dy = event.clientY - startY;
      if (!horizontal) {
        if (Math.abs(dx) < decideAt && Math.abs(dy) < decideAt) {
          return;
        }
        horizontal = Math.abs(dx) > Math.abs(dy);
        if (!horizontal) {
          tracking = false;
          return;
        }
      }
      if (dx <= -swipeMin) {
        reset();
        closing.current();
      }
    };

    // Chromium takes a horizontal drag for itself a few moves in and cancels the
    // pointer stream, which touch-action: pan-y on its own does not prevent
    const onTouchMove = (event: TouchEvent): void => {
      if (horizontal && event.cancelable) {
        event.preventDefault();
      }
    };

    node.addEventListener('pointerdown', onDown);
    node.addEventListener('pointermove', onMove);
    node.addEventListener('pointerup', reset);
    node.addEventListener('pointercancel', reset);
    node.addEventListener('touchmove', onTouchMove, { passive: false });

    return () => {
      node.removeEventListener('pointerdown', onDown);
      node.removeEventListener('pointermove', onMove);
      node.removeEventListener('pointerup', reset);
      node.removeEventListener('pointercancel', reset);
      node.removeEventListener('touchmove', onTouchMove);
    };
  }, []);
}
