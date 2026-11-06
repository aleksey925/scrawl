import { Menu, type FloatingPosition } from '@mantine/core';
import { useEffect, useState, type ComponentPropsWithRef, type JSX, type MouseEvent, type ReactPortal } from 'react';
import { createPortal } from 'react-dom';

import type { EntryKind } from '../api/types';
import { IconFilePlus, IconFolderPlus } from '../icons';
import { layout } from '../theme';

import { PopupMenu } from './PopupMenu';

export interface Point {
  x: number;
  y: number;
}

export const pointerPlacement: { position: FloatingPosition; offset: number } = { position: 'bottom-start', offset: 2 };

export function pointOf(event: MouseEvent): Point {
  return { x: event.clientX, y: event.clientY };
}

interface PointerAnchorProps extends ComponentPropsWithRef<'span'> {
  at: Point;
}

function PointerAnchor({ at, ...rest }: PointerAnchorProps): ReactPortal {
  return createPortal(
    <span
      {...rest}
      aria-hidden
      style={{ position: 'fixed', left: at.x, top: at.y, width: 0, height: 0, pointerEvents: 'none' }}
    />,
    document.body,
  );
}

export function pointerAnchor(at: Point): JSX.Element {
  return <PointerAnchor at={at} />;
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

export interface PointerMenu {
  at: Point | undefined;
  opened: boolean;
  setOpened: (opened: boolean) => void;
  onContextMenu: (event: MouseEvent) => void;
}

export function usePointerMenu(): PointerMenu {
  const [at, setAt] = useState<Point | undefined>(undefined);
  const [opened, setOpened] = useState(false);
  const onContextMenu = (event: MouseEvent): void => {
    if (opensOwnMenu(event)) {
      event.preventDefault();
      setAt(pointOf(event));
      setOpened(true);
    }
  };
  return { at, opened, setOpened, onContextMenu };
}

export interface NewEntryMenuProps {
  menu: PointerMenu;
  testId: string;
  onCreate: (kind: EntryKind) => void;
}

export function NewEntryMenu({ menu, testId, onCreate }: NewEntryMenuProps): JSX.Element | null {
  const { at, opened, setOpened } = menu;
  useCloseOnScroll(opened, setOpened);
  if (at === undefined) {
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
      <Menu.Target>{pointerAnchor(at)}</Menu.Target>
      <Menu.Dropdown data-testid={testId}>
        <Menu.Item
          data-testid={`${testId}-new-file`}
          leftSection={<IconFilePlus size={layout.iconSizeSmall} />}
          onClick={() => onCreate('file')}
        >
          New file
        </Menu.Item>
        <Menu.Item
          data-testid={`${testId}-new-folder`}
          leftSection={<IconFolderPlus size={layout.iconSizeSmall} />}
          onClick={() => onCreate('dir')}
        >
          New folder
        </Menu.Item>
      </Menu.Dropdown>
    </PopupMenu>
  );
}
