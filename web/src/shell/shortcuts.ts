import { useMediaQuery } from '@mantine/hooks';

const apple = /mac|iphone|ipad|ipod/i.test(navigator.platform || navigator.userAgent);
export const modKey = apple ? '⌘' : 'Ctrl';
export const altKey = apple ? '⌥' : 'Alt';

export function keysLabel(...keys: readonly string[]): string {
  return keys.join(apple ? '' : '+');
}

export function modChord(event: KeyboardEvent, key: string): boolean {
  return (event.metaKey || event.ctrlKey) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === key;
}

const ownsShortcutsAttribute = 'data-owns-shortcuts';
export const ownsShortcuts = { [ownsShortcutsAttribute]: '' } as const;

export function appShortcut(event: KeyboardEvent): boolean {
  if (event.defaultPrevented) {
    return false;
  }
  const { target } = event;
  return !(target instanceof Element && target.closest(`[${ownsShortcutsAttribute}]`) !== null);
}

export function plainShortcut(event: KeyboardEvent): boolean {
  const { target } = event;
  if (typingInto(target) || !appShortcut(event)) {
    return false;
  }
  return !(target instanceof Element && target.closest('[role="dialog"], dialog') !== null);
}

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

export function useKeyboardPlace(): boolean {
  return useMediaQuery('(hover: hover)', true, { getInitialValueInEffect: false });
}
