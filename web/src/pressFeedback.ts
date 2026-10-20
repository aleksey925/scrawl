// enablePressFeedback lets a tap draw the pressed state. iOS Safari applies
// :active only under an element that listens for touchstart, and a menu in a
// portal sits outside the root react listens on.
export function enablePressFeedback(): void {
  document.addEventListener('touchstart', () => undefined, { passive: true });
}
