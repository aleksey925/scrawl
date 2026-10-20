import { Menu, type MenuProps } from '@mantine/core';
import { useUncontrolled } from '@mantine/hooks';
import type { JSX } from 'react';

import { TapGuard, useTouchScreen } from './TapGuard';

// PopupMenu is mantine's Menu, opened beside the control that opened it, with
// the guard that keeps a tap beside it on a touch screen from going through
export function PopupMenu({ opened, defaultOpened, onChange, children, ...rest }: MenuProps): JSX.Element {
  const [open, setOpen] = useUncontrolled({ value: opened, defaultValue: defaultOpened, finalValue: false, onChange });
  const touch = useTouchScreen();

  return (
    <>
      {/* fixed, because a menu placed on the page moved the page: the focus it
          takes on opening scrolled to where it stood before it was placed */}
      <Menu floatingStrategy="fixed" {...rest} opened={open} onChange={setOpen} closeOnClickOutside={!touch}>
        {children}
      </Menu>
      <TapGuard active={open} onClose={() => setOpen(false)} />
    </>
  );
}
