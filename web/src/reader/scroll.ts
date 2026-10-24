function scrollerOf(element: HTMLElement): HTMLElement | Window {
  for (let node = element.parentElement; node !== null; node = node.parentElement) {
    const overflow = getComputedStyle(node).overflowY;
    if ((overflow === 'auto' || overflow === 'scroll') && node.scrollHeight > node.clientHeight) {
      return node;
    }
  }
  return window;
}

export function preserveScroll(root: HTMLElement, update: () => void): void {
  const anchor = Array.from(root.children).find((child) => child.getBoundingClientRect().bottom > 0);
  const before = anchor === undefined ? 0 : anchor.getBoundingClientRect().top;

  update();

  if (anchor === undefined) {
    return;
  }
  const delta = anchor.getBoundingClientRect().top - before;
  if (Math.abs(delta) <= 1) {
    return;
  }
  scrollerOf(root).scrollBy({ top: delta, behavior: 'instant' });
}
