// ownsShortcutsAttribute marks an element whose own keys outrank the app's: an
// editor's keymap may leave a key unhandled, bold inside a code block, and the
// sidebar must not toggle in the middle of typing
export const ownsShortcutsAttribute = 'data-owns-shortcuts';

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

// typingInto says whether a plain key would type into the element, which a
// shortcut with no modifier must leave alone
export function typingInto(target: EventTarget | null): boolean {
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
