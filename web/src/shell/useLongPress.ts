import { useCallback, useEffect, useRef, type MouseEvent, type PointerEvent } from 'react';

const longPressMs = 500;
const longPressSlop = 10;

export interface LongPressHandlers {
  onPointerDown: (event: PointerEvent) => void;
  onPointerMove: (event: PointerEvent) => void;
  onPointerUp: () => void;
  onPointerCancel: () => void;
  onClickCapture: (event: MouseEvent) => void;
}

export function useLongPress(onLongPress: () => void, onHold?: (holding: boolean) => void): LongPressHandlers {
  const timer = useRef<number | undefined>(undefined);
  const start = useRef<{ x: number; y: number } | undefined>(undefined);
  const fired = useRef(false);

  const holdRef = useRef(onHold);
  useEffect(() => {
    holdRef.current = onHold;
  });

  const cancel = useCallback(() => {
    if (timer.current !== undefined) {
      holdRef.current?.(false);
    }
    window.clearTimeout(timer.current);
    timer.current = undefined;
    start.current = undefined;
  }, []);

  useEffect(() => cancel, [cancel]);

  const onPointerDown = useCallback(
    (event: PointerEvent) => {
      fired.current = false;
      if (event.pointerType === 'mouse' || !event.currentTarget.contains(event.target as Node)) {
        return;
      }
      cancel();
      start.current = { x: event.clientX, y: event.clientY };
      holdRef.current?.(true);
      timer.current = window.setTimeout(() => {
        fired.current = true;
        start.current = undefined;
        timer.current = undefined;
        holdRef.current?.(false);
        onLongPress();
      }, longPressMs);
    },
    [cancel, onLongPress],
  );

  const onPointerMove = useCallback(
    (event: PointerEvent) => {
      const from = start.current;
      if (from !== undefined && Math.hypot(event.clientX - from.x, event.clientY - from.y) > longPressSlop) {
        cancel();
      }
    },
    [cancel],
  );

  const onClickCapture = useCallback((event: MouseEvent) => {
    if (fired.current) {
      fired.current = false;
      event.preventDefault();
      event.stopPropagation();
    }
  }, []);

  return { onPointerDown, onPointerMove, onPointerUp: cancel, onPointerCancel: cancel, onClickCapture };
}
