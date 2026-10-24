import { Overlay, Portal } from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { useEffect, useRef, type JSX } from 'react';

import classes from './TapGuard.module.css';

export function useTouchScreen(): boolean {
  return useMediaQuery('(hover: none), (pointer: coarse)', false, { getInitialValueInEffect: false });
}

export function TapGuard({ active, onClose }: { active: boolean; onClose: () => void }): JSX.Element | null {
  const touch = useTouchScreen();
  const pressed = useRef(false);
  useEffect(() => {
    pressed.current = false;
  }, [active]);
  if (!active || !touch) {
    return null;
  }
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
