import { Overlay, Portal } from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { useEffect, useRef, type JSX } from 'react';

import classes from './TapGuard.module.css';

// useTouchScreen says whether taps, not a pointer, drive the page
export function useTouchScreen(): boolean {
  return useMediaQuery('(hover: none), (pointer: coarse)', false, { getInitialValueInEffect: false });
}

// TapGuard lies under an open menu or popover on a touch screen and takes the
// tap that closes it. The menu's own outside tap closed it on touchstart, and
// the click that followed landed on the row underneath and opened the file
// there, so on a touch screen the guard does the closing, on the click.
export function TapGuard({ active, onClose }: { active: boolean; onClose: () => void }): JSX.Element | null {
  const touch = useTouchScreen();
  // only a tap that started on the guard closes: a long press opens a menu
  // while the finger is still down, and lifting it sent the guard a click
  const pressed = useRef(false);
  // a tap that started on the guard and turned into a scroll never clicks, and
  // left set it closed the next menu the moment a long press opened it
  useEffect(() => {
    pressed.current = false;
  }, [active]);
  if (!active || !touch) {
    return null;
  }
  // in a portal: inside a row the row's stacking context let later rows paint
  // over the guard, and a press on the guard pressed the row and timed it
  return (
    <Portal>
      <Overlay
        data-testid="tap-guard"
        fixed
        className={classes.guard}
        zIndex={299}
        onPointerDown={() => {
          pressed.current = true;
        }}
        onClick={() => {
          if (pressed.current) {
            pressed.current = false;
            onClose();
          }
        }}
      />
    </Portal>
  );
}
