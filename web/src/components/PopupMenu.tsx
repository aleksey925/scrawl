import { Menu, type FloatingPosition, type MantineTransition, type MenuProps } from '@mantine/core';
import { useUncontrolled } from '@mantine/hooks';
import { useState, type JSX } from 'react';

import { springEasing } from './screenMotion';
import { TapGuard, useTouchScreen } from './TapGuard';

// growOrigin is the corner of a menu nearest what opened it: a menu under its
// button grows down from the button, one that flipped above grows up
function growOrigin(position: FloatingPosition): string {
  const [side = 'bottom', align] = position.split('-');
  const vertical = side === 'top' ? 'bottom' : side === 'bottom' ? 'top' : 'center';
  const horizontal =
    side === 'left' ? 'right' : side === 'right' ? 'left' : align === 'start' ? 'left' : align === 'end' ? 'right' : 'center';
  return `${vertical} ${horizontal}`;
}

const menuGrowMs = 220;

// a phone's menu grows out of what opened it, with a little spring at the end
function grow(position: FloatingPosition): MantineTransition {
  return {
    in: { opacity: 1, transform: 'scale(1)' },
    out: { opacity: 0, transform: 'scale(0.5)' },
    common: { transformOrigin: growOrigin(position) },
    transitionProperty: 'transform, opacity',
  };
}

// PopupMenu is mantine's Menu, opened beside the control that opened it, with
// the guard that keeps a tap beside it on a touch screen from going through
export function PopupMenu({
  opened,
  defaultOpened,
  onChange,
  onPositionChange,
  children,
  ...rest
}: MenuProps): JSX.Element {
  const [open, setOpen] = useUncontrolled({ value: opened, defaultValue: defaultOpened, finalValue: false, onChange });
  const touch = useTouchScreen();
  const [placed, setPlaced] = useState<FloatingPosition>(rest.position ?? 'bottom');

  return (
    <>
      {/* fixed, because a menu placed on the page moved the page: the focus it
          takes on opening scrolled to where it stood before it was placed */}
      <Menu
        floatingStrategy="fixed"
        transitionProps={
          touch ? { transition: grow(placed), duration: menuGrowMs, timingFunction: springEasing } : undefined
        }
        middlewares={touch ? { flip: true, shift: { padding: 8 } } : undefined}
        {...rest}
        opened={open}
        onChange={setOpen}
        onPositionChange={(position) => {
          setPlaced(position);
          onPositionChange?.(position);
        }}
        closeOnClickOutside={!touch}
      >
        {children}
      </Menu>
      <TapGuard active={open} onClose={() => setOpen(false)} />
    </>
  );
}
