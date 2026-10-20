import { useCallback, useEffect, useRef, type MouseEvent, type PointerEvent } from 'react';

// longPressMs is how long a finger rests on a row before it counts as asking
// for the row's menu, the time a phone's own long press takes
const longPressMs = 500;
// a finger drifts while it rests; past this it is scrolling the list
const longPressSlop = 10;

export interface LongPressHandlers {
  onPointerDown: (event: PointerEvent) => void;
  onPointerMove: (event: PointerEvent) => void;
  onPointerUp: () => void;
  onPointerCancel: () => void;
  onClickCapture: (event: MouseEvent) => void;
}

// useLongPress calls back when a finger or a pen rests on an element. iOS sends
// no contextmenu for a long press, so the press is timed here; the click the
// lifted finger sends afterwards is swallowed, or the row would also open.
export function useLongPress(onLongPress: () => void): LongPressHandlers {
  const timer = useRef<number | undefined>(undefined);
  const start = useRef<{ x: number; y: number } | undefined>(undefined);
  const fired = useRef(false);

  const cancel = useCallback(() => {
    window.clearTimeout(timer.current);
    timer.current = undefined;
    start.current = undefined;
  }, []);

  useEffect(() => cancel, [cancel]);

  const onPointerDown = useCallback(
    (event: PointerEvent) => {
      fired.current = false;
      if (event.pointerType === 'mouse') {
        return;
      }
      cancel();
      start.current = { x: event.clientX, y: event.clientY };
      timer.current = window.setTimeout(() => {
        fired.current = true;
        start.current = undefined;
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
