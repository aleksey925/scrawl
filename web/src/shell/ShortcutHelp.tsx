import { Menu, Modal } from '@mantine/core';
import { useEffect, type JSX, type ReactNode } from 'react';

import { IconKeyboard } from '../icons';
import { usePlatform } from '../platform';
import { layout } from '../theme';

import classes from './ShortcutHelp.module.css';
import { altKey, modKey, plainShortcut } from './shortcuts';

type Need = 'search' | 'editing';

interface Shortcut {
  keys: readonly string[];
  what: string;
  needs?: Need;
}

interface ShortcutGroup {
  name: string;
  needs?: Need;
  rows: readonly Shortcut[];
}

const groups: readonly ShortcutGroup[] = [
  {
    name: 'General',
    rows: [
      { keys: [modKey, 'K'], what: 'Search the space', needs: 'search' },
      { keys: [modKey, 'B'], what: 'Show or hide the sidebar' },
      { keys: ['?'], what: 'Show this list' },
      { keys: ['Esc'], what: 'Close a panel or clear the filter' },
    ],
  },
  {
    name: 'Note',
    rows: [
      { keys: [modKey, 'F'], what: 'Find in the note' },
      { keys: ['↵'], what: 'Next match' },
      { keys: ['Shift', '↵'], what: 'Previous match' },
      { keys: [altKey, 'C'], what: 'Match case' },
      { keys: [altKey, 'W'], what: 'Whole word' },
      { keys: [altKey, 'R'], what: 'Regular expression' },
      { keys: ['E'], what: 'Edit the note', needs: 'editing' },
      { keys: ['↵'], what: 'Create a note that does not exist yet', needs: 'editing' },
      { keys: ['←', '→'], what: 'Step through the pictures in the viewer' },
      { keys: ['+', '-'], what: 'Zoom in or out in the viewer' },
      { keys: ['0'], what: 'Fit the picture or diagram to the screen' },
      { keys: ['1'], what: 'Show it at its actual size' },
    ],
  },
  {
    name: 'Search',
    needs: 'search',
    rows: [
      { keys: ['↑', '↓'], what: 'Select a result' },
      { keys: ['↵'], what: 'Open it' },
      { keys: [altKey, 'F'], what: 'Fuzzy or exact' },
      { keys: [altKey, 'C'], what: 'Match case' },
      { keys: [altKey, 'W'], what: 'Whole word' },
      { keys: [altKey, 'R'], what: 'Regular expression' },
    ],
  },
  {
    name: 'Editor',
    needs: 'editing',
    rows: [
      { keys: [modKey, 'S'], what: 'Save' },
      { keys: ['Shift', altKey, 'F'], what: 'Format the note' },
    ],
  },
];

export function MenuKeys({ children }: { children: ReactNode }): JSX.Element {
  return <span className={classes.menuKeys}>{children}</span>;
}

export function ShortcutsMenuItem({ onClick }: { onClick: () => void }): JSX.Element {
  return (
    <Menu.Item
      data-testid="space-menu-shortcuts"
      leftSection={<IconKeyboard size={layout.iconSizeSmall} />}
      rightSection={<MenuKeys>?</MenuKeys>}
      onClick={onClick}
    >
      Keyboard shortcuts
    </Menu.Item>
  );
}

export interface ShortcutHelpProps {
  opened: boolean;
  onOpen: () => void;
  onClose: () => void;
}

export function ShortcutHelp({ opened, onOpen, onClose }: ShortcutHelpProps): JSX.Element {
  const platform = usePlatform();
  const offers = (need: Need | undefined): boolean => need === undefined || platform[need];

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== '?' || event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }
      if (!plainShortcut(event)) {
        return;
      }
      event.preventDefault();
      onOpen();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onOpen]);

  return (
    <Modal opened={opened} onClose={onClose} title="Keyboard shortcuts" size={560}>
      <div data-testid="shortcuts" className={classes.groups}>
        {groups
          .filter((entry) => offers(entry.needs))
          .map((entry) => (
            <section key={entry.name} data-testid="shortcuts-group" data-group={entry.name} className={classes.group}>
              <h3 className={classes.name}>{entry.name}</h3>
              {entry.rows
                .filter((shortcut) => offers(shortcut.needs))
                .map((shortcut) => (
                  <div key={shortcut.what + shortcut.keys.join()} className={classes.row}>
                    <span>{shortcut.what}</span>
                    <span className={classes.keys}>
                      {shortcut.keys.map((name) => (
                        <kbd key={name} className={classes.key}>
                          {name}
                        </kbd>
                      ))}
                    </span>
                  </div>
                ))}
            </section>
          ))}
      </div>
      <div className={classes.footer}>
        Press <kbd className={classes.key}>?</kbd> anywhere outside a text field to open this list.
      </div>
    </Modal>
  );
}
