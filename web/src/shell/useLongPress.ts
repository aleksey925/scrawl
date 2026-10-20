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
// onHold hears when a finger starts resting and when it stops, by lifting,
// moving off or having held long enough.
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
      // react hands a press inside a menu in a portal up to the row the menu
      // belongs to, and that press must not start timing the row
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
