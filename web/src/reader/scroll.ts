// the reading view scrolls the window, an embedded preview scrolls itself
function scrollerOf(element: HTMLElement): HTMLElement | Window {
  for (let node = element.parentElement; node !== null; node = node.parentElement) {
    const overflow = getComputedStyle(node).overflowY;
    if ((overflow === 'auto' || overflow === 'scroll') && node.scrollHeight > node.clientHeight) {
      return node;
    }
  }
  return window;
}

// preserveScroll runs a layout changing update and scrolls by however far the
// visible content moved. Typeset math and a rendered diagram are much taller
// than the source they replace, and without this the page jumps out from under
// a reader who is already below them.
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
  // instant: the page carries smooth scrolling and animating the correction is
  // exactly the movement this exists to hide
  scrollerOf(root).scrollBy({ top: delta, behavior: 'instant' });
}
