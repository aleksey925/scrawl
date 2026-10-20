import { Modal } from '@mantine/core';
import { useEffect, type JSX } from 'react';

import { usePlatform } from '../platform';

import classes from './ShortcutHelp.module.css';
import { appShortcut, typingInto } from './shortcuts';

// Mantine resolves "mod" to command on apple hardware and to control everywhere
// else; this only spells the same choice out for the reader
const apple = /mac|iphone|ipad|ipod/i.test(navigator.platform || navigator.userAgent);
const modKey = apple ? '⌘' : 'Ctrl';
const altKey = apple ? '⌥' : 'Alt';

type Need = 'search' | 'editing';

interface Shortcut {
  keys: readonly string[];
  what: string;
  // needs is what the reader must offer for the keys to do anything
  needs?: Need;
}

interface ShortcutGroup {
  name: string;
  needs?: Need;
  rows: readonly Shortcut[];
}

// the one table of what the app answers to, shown only where the place offers it
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
      { keys: ['←', '→'], what: 'Step through the images in the viewer' },
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
      if (typingInto(event.target) || !appShortcut(event)) {
        return;
      }
      event.preventDefault();
      onOpen();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onOpen]);

  return (
    <Modal opened={opened} onClose={onClose} title="Keyboard shortcuts" size={560} radius="lg">
      {/* the modal root is a zero height wrapper around the portal, so the name
          goes on the list itself, which is what is actually on the screen */}
      <div data-testid="shortcuts" className={classes.groups}>
        {groups
          .filter((group) => offers(group.needs))
          .map((group) => (
            <section key={group.name} data-testid="shortcuts-group" data-group={group.name} className={classes.group}>
              <h3 className={classes.name}>{group.name}</h3>
              {group.rows
                .filter((row) => offers(row.needs))
                .map((row) => (
                  <div key={row.what + row.keys.join()} className={classes.row}>
                    <span>{row.what}</span>
                    <span className={classes.keys}>
                      {row.keys.map((key) => (
                        <kbd key={key} className={classes.key}>
                          {key}
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
