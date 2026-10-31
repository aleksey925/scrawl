export function enablePressFeedback(): void {
  document.addEventListener('touchstart', () => undefined, { passive: true });
}
