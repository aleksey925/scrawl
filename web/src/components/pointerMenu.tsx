import { Menu, type FloatingPosition } from '@mantine/core';
import { useEffect, useState, type ComponentPropsWithRef, type JSX, type MouseEvent, type ReactPortal } from 'react';
import { createPortal } from 'react-dom';

import type { EntryKind } from '../api/types';
import { IconFilePlus, IconFolderPlus } from '../icons';
import { layout } from '../theme';

import { FieldMenuItem, PopupMenu } from './PopupMenu';

export interface Point {
  x: number;
  y: number;
}

export interface MenuPlacement {
  position: FloatingPosition;
  offset?: number;
}

export const pointerPlacement: MenuPlacement = { position: 'bottom-start', offset: 2 };

function pointOf(event: MouseEvent): Point {
  return { x: event.clientX, y: event.clientY };
}

export interface AnchorRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export function rectAt(at: Point): AnchorRect {
  return { left: at.x, top: at.y, width: 0, height: 0 };
}

interface FixedAnchorProps extends ComponentPropsWithRef<'span'> {
  rect: AnchorRect;
}

export function FixedAnchor({ rect, ...rest }: FixedAnchorProps): ReactPortal {
  const { left, top, width, height } = rect;
  return createPortal(
    <span {...rest} aria-hidden style={{ position: 'fixed', left, top, width, height, pointerEvents: 'none' }} />,
    document.body,
  );
}

export function useCloseOnScroll(opened: boolean, setOpened: (opened: boolean) => void): void {
  useEffect(() => {
    if (!opened) {
      return;
    }
    const close = (): void => setOpened(false);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [opened, setOpened]);
}

function opensOwnMenu(event: MouseEvent): boolean {
  if (event.defaultPrevented || !(event.target instanceof Element) || !event.currentTarget.contains(event.target)) {
    return false;
  }
  if (event.target.closest('a, button, input, textarea, [contenteditable="true"]') !== null) {
    return false;
  }
  const selection = window.getSelection();
  return selection === null || selection.isCollapsed;
}

export interface PointerMenu<T> {
  at: Point | undefined;
  target: T | undefined;
  opened: boolean;
  setOpened: (opened: boolean) => void;
  open: (event: MouseEvent, target: T) => void;
  onFreeSpace: (event: MouseEvent, target: T) => void;
}

export function usePointerMenu<T>(): PointerMenu<T> {
  const [place, setPlace] = useState<{ at: Point; target: T } | undefined>(undefined);
  const [opened, setOpened] = useState(false);
  const open = (event: MouseEvent, target: T): void => {
    event.preventDefault();
    setPlace({ at: pointOf(event), target });
    setOpened(true);
  };
  const onFreeSpace = (event: MouseEvent, target: T): void => {
    if (opensOwnMenu(event)) {
      open(event, target);
    }
  };
  return { at: place?.at, target: place?.target, opened, setOpened, open, onFreeSpace };
}

export interface NewEntryMenuProps {
  menu: PointerMenu<string>;
  testId: string;
  onCreate: (kind: EntryKind, folder: string) => void;
}

export function NewEntryMenu({ menu, testId, onCreate }: NewEntryMenuProps): JSX.Element | null {
  const { at, target: folder, opened, setOpened } = menu;
  useCloseOnScroll(opened, setOpened);
  if (at === undefined || folder === undefined) {
    return null;
  }
  return (
    <PopupMenu
      key={`${at.x}:${at.y}`}
      opened={opened}
      onChange={setOpened}
      {...pointerPlacement}
      withinPortal
      shadow="md"
      width={layout.menuWidthNarrow}
    >
      <Menu.Target>
        <FixedAnchor rect={rectAt(at)} />
      </Menu.Target>
      <Menu.Dropdown data-testid={testId}>
        <FieldMenuItem
          data-testid={`${testId}-new-file`}
          leftSection={<IconFilePlus size={layout.iconSizeSmall} />}
          onClick={() => onCreate('file', folder)}
        >
          New file
        </FieldMenuItem>
        <FieldMenuItem
          data-testid={`${testId}-new-folder`}
          leftSection={<IconFolderPlus size={layout.iconSizeSmall} />}
          onClick={() => onCreate('dir', folder)}
        >
          New folder
        </FieldMenuItem>
      </Menu.Dropdown>
    </PopupMenu>
  );
}
