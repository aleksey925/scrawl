import { useMediaQuery } from '@mantine/hooks';

// Mantine resolves "mod" to command on apple hardware and to control everywhere
// else; these only spell the same choice out for the reader
const apple = /mac|iphone|ipad|ipod/i.test(navigator.platform || navigator.userAgent);
export const modKey = apple ? '⌘' : 'Ctrl';
export const altKey = apple ? '⌥' : 'Alt';

// keysLabel writes a chord the way the platform's own menus do: ⌘F, Ctrl+F
export function keysLabel(...keys: readonly string[]): string {
  return keys.join(apple ? '' : '+');
}

// modChord says whether the key is Cmd (Ctrl off a Mac) with the letter and no
// other modifier
export function modChord(event: KeyboardEvent, key: string): boolean {
  return (event.metaKey || event.ctrlKey) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === key;
}

// ownsShortcuts marks an element whose own keys outrank the app's: a keymap may
// leave a key unhandled, bold in a code block, and the sidebar must stay put
const ownsShortcutsAttribute = 'data-owns-shortcuts';
export const ownsShortcuts = { [ownsShortcutsAttribute]: '' } as const;

// appShortcut says whether a key the app binds on the document is the app's to
// take: nothing handled it already and it was not pressed inside an element
// that owns its keys
export function appShortcut(event: KeyboardEvent): boolean {
  if (event.defaultPrevented) {
    return false;
  }
  const { target } = event;
  return !(target instanceof Element && target.closest(`[${ownsShortcutsAttribute}]`) !== null);
}

// plainShortcut says whether a key with no modifier is the app's to take: not
// typed into a field, and not pressed in a dialog, whose own list it is meant for
export function plainShortcut(event: KeyboardEvent): boolean {
  const { target } = event;
  if (typingInto(target) || !appShortcut(event)) {
    return false;
  }
  return !(target instanceof Element && target.closest('[role="dialog"], dialog') !== null);
}

// typingInto says whether a plain key would type into the element, which a
// shortcut with no modifier must leave alone
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

// useKeyboardPlace says whether the place is one with a keyboard to speak of:
// a pointer that hovers. A phone gets no list of keys and no key beside a menu
// row, which it has nothing to press with.
export function useKeyboardPlace(): boolean {
  return useMediaQuery('(hover: hover)', true, { getInitialValueInEffect: false });
}
