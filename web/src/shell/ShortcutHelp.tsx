import { Group, Kbd, Modal, Stack, Text } from '@mantine/core';
import { useEffect, useState, type JSX } from 'react';

// Mantine resolves "mod" to command on apple hardware and to control everywhere
// else; this only spells the same choice out for the reader
const apple = /mac|iphone|ipad|ipod/i.test(navigator.platform || navigator.userAgent);
const modKey = apple ? '⌘' : 'Ctrl';

interface Shortcut {
  keys: readonly string[];
  what: string;
}

// only what the app really answers to: the palette shortcuts on Spotlight, the
// save in the editor, Escape on the find bar and the filter, the arrows in the
// image viewer
const shortcuts: readonly Shortcut[] = [
  { keys: [modKey, 'K'], what: 'Open the search palette' },
  { keys: ['/'], what: 'Open the search palette' },
  { keys: ['?'], what: 'Show this list' },
  { keys: [modKey, 'S'], what: 'Save the document being edited' },
  { keys: ['Esc'], what: 'Close a panel, clear the filter or the highlighting' },
  { keys: ['←', '→'], what: 'Step through the images in the viewer' },
];

function typingInto(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  return (
    target.isContentEditable ||
    target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    target.tagName === 'SELECT'
  );
}

export function ShortcutHelp(): JSX.Element {
  const [opened, setOpened] = useState(false);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== '?' || event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }
      if (typingInto(event.target)) {
        return;
      }
      event.preventDefault();
      setOpened(true);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <Modal opened={opened} onClose={() => setOpened(false)} title="Keyboard shortcuts" size="md">
      {/* the modal root is a zero height wrapper around the portal, so the name
          goes on the list itself, which is what is actually on the screen */}
      <Stack data-testid="shortcuts" gap="sm">
        {shortcuts.map((shortcut) => (
          <Group key={shortcut.what + shortcut.keys.join()} justify="space-between" wrap="nowrap" gap="lg">
            <Text size="sm">{shortcut.what}</Text>
            <Group gap={4} wrap="nowrap" style={{ flex: 'none' }}>
              {shortcut.keys.map((key) => (
                <Kbd key={key} size="sm">
                  {key}
                </Kbd>
              ))}
            </Group>
          </Group>
        ))}
      </Stack>
    </Modal>
  );
}
