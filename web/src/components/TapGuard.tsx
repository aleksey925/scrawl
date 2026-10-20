import { Overlay } from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import type { JSX } from 'react';

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
  if (!active || !touch) {
    return null;
  }
  return <Overlay data-testid="tap-guard" fixed className={classes.guard} zIndex={299} onClick={onClose} />;
}
