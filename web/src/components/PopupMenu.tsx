import { Menu, type FloatingPosition, type MantineTransition, type MenuItemProps, type MenuProps } from '@mantine/core';
import { useUncontrolled } from '@mantine/hooks';
import { createContext, useContext, useState, type JSX } from 'react';

import { springEasing } from './screenMotion';
import { TapGuard, useTouchScreen } from './TapGuard';

function growOrigin(position: FloatingPosition): string {
  const [side = 'bottom', align] = position.split('-');
  const vertical = side === 'top' ? 'bottom' : side === 'bottom' ? 'top' : 'center';
  const horizontal =
    side === 'left' ? 'right' : side === 'right' ? 'left' : align === 'start' ? 'left' : align === 'end' ? 'right' : 'center';
  return `${vertical} ${horizontal}`;
}

const menuGrowMs = 220;

function grow(position: FloatingPosition): MantineTransition {
  return {
    in: { opacity: 1, transform: 'scale(1)' },
    out: { opacity: 0, transform: 'scale(0.5)' },
    common: { transformOrigin: growOrigin(position) },
    transitionProperty: 'transform, opacity',
  };
}

const KeepFocusContext = createContext<() => void>(() => undefined);

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
  const [focusKept, setFocusKept] = useState(false);
  if (open && focusKept) {
    setFocusKept(false);
  }

  return (
    <KeepFocusContext.Provider value={() => setFocusKept(true)}>
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
        returnFocus={!focusKept && (rest.returnFocus ?? true)}
      >
        {children}
      </Menu>
      <TapGuard active={open} onClose={() => setOpen(false)} />
    </KeepFocusContext.Provider>
  );
}

export interface FieldMenuItemProps extends MenuItemProps {
  'data-testid': string;
  onClick: () => void;
}

export function FieldMenuItem({ onClick, ...rest }: FieldMenuItemProps): JSX.Element {
  const keepFocus = useContext(KeepFocusContext);
  return (
    <Menu.Item
      {...rest}
      onClick={() => {
        keepFocus();
        onClick();
      }}
    />
  );
}

export function menuRectOf(item: Element): DOMRect {
  return (item.closest('[role="menu"]') ?? item).getBoundingClientRect();
}
