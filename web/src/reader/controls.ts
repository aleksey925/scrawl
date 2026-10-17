import { copyText } from './clipboard';
import { headingsOf, imagesOf } from './dom';

export const anchorClass = 'md-anchor';
export const copyClass = 'md-copy';
export const copyLabel = 'Copy';
export const copiedLabel = 'Copied';

const copiedFor = 1500;

type Teardown = () => void;

// injectControls adds the reading controls the server does not render and
// returns the teardown, because React never owns anything inside injected html
export function injectControls(root: HTMLElement): Teardown {
  const teardowns = [injectHeadingAnchors(root), injectCopyButtons(root), prepareImages(root)];
  return () => {
    for (const teardown of teardowns) {
      teardown();
    }
  };
}

// note html is the reader's own, so every hook put on it is taken back off
// again: React never owns anything in here to re-render it away
function tagged(): { tag: (element: HTMLElement, testid: string) => void; untag: Teardown } {
  const elements: HTMLElement[] = [];
  return {
    tag: (element, testid) => {
      element.dataset.testid = testid;
      elements.push(element);
    },
    untag: () => {
      for (const element of elements) {
        delete element.dataset.testid;
      }
    },
  };
}

function removing(added: readonly HTMLElement[], untag: Teardown): Teardown {
  return () => {
    for (const node of added) {
      node.remove();
    }
    untag();
  };
}

export function injectHeadingAnchors(root: HTMLElement): Teardown {
  const added: HTMLElement[] = [];
  const { tag, untag } = tagged();
  for (const heading of headingsOf(root)) {
    if (heading.querySelector(`.${anchorClass}`) !== null) {
      continue;
    }
    tag(heading, 'doc-heading');
    const anchor = document.createElement('a');
    anchor.className = anchorClass;
    anchor.dataset.testid = 'doc-heading-anchor';
    anchor.setAttribute('href', `#${encodeURIComponent(heading.id)}`);
    anchor.dataset.headingId = heading.id;
    anchor.setAttribute('aria-label', 'Copy a link to this section');
    heading.append(anchor);
    added.push(anchor);
  }
  return removing(added, untag);
}

export function injectCopyButtons(root: HTMLElement): Teardown {
  const added: HTMLElement[] = [];
  const { tag, untag } = tagged();
  for (const block of root.querySelectorAll<HTMLElement>('.code-block')) {
    const code = block.querySelector('pre');
    // a mermaid fence is source for the diagram renderer, not something to copy
    if (code === null || code.classList.contains('mermaid')) {
      continue;
    }
    if (block.querySelector(`.${copyClass}`) !== null) {
      continue;
    }
    tag(block, 'doc-code');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = copyClass;
    button.dataset.testid = 'code-copy';
    button.dataset.done = 'false';
    button.textContent = copyLabel;
    block.append(button);
    added.push(button);
  }
  return removing(added, untag);
}

// the zoom is advertised with cursor: zoom-in, which only a pointer sees, so
// the image carries the role and takes a key press of its own
export function prepareImages(root: HTMLElement): Teardown {
  const prepared: HTMLImageElement[] = [];
  const { tag, untag } = tagged();
  for (const image of imagesOf(root)) {
    image.tabIndex = 0;
    image.setAttribute('role', 'button');
    image.setAttribute('aria-label', image.alt === '' ? 'Open image' : `Open image: ${image.alt}`);
    tag(image, 'doc-image');
    prepared.push(image);
  }
  return () => {
    for (const image of prepared) {
      image.removeAttribute('tabindex');
      image.removeAttribute('role');
      image.removeAttribute('aria-label');
    }
    untag();
  };
}

// copyCode copies the code beside a copy button and says so on the button for
// a moment. It answers false when the clipboard refused.
export async function copyCode(button: HTMLElement, timers: Set<number>): Promise<boolean> {
  const code = button.closest('.code-block')?.querySelector('pre');
  if (!(await copyText(code?.textContent ?? ''))) {
    return false;
  }
  button.dataset.done = 'true';
  button.textContent = copiedLabel;
  const timer = window.setTimeout(() => {
    button.dataset.done = 'false';
    button.textContent = copyLabel;
    timers.delete(timer);
  }, copiedFor);
  timers.add(timer);
  return true;
}

// pictureOf is the picture a click or a key press on it opens. One inside a
// link is not: the link is the author's, and following it is what they meant.
export function pictureOf(target: EventTarget | null): HTMLImageElement | undefined {
  const image = target instanceof Element ? target.closest('img') : null;
  return image instanceof HTMLImageElement && image.closest('a') === null ? image : undefined;
}

// pictureKeyed is the picture Enter or Space was pressed on
export function pictureKeyed(event: KeyboardEvent): HTMLImageElement | undefined {
  return event.key === 'Enter' || event.key === ' ' ? pictureOf(event.target) : undefined;
}

// sectionLink is the address of a heading on this page. Not location.origin: a
// page opened from disk has none in Firefox, and the link would start "null".
export function sectionLink(id: string): string {
  return `${window.location.href.split(/[?#]/)[0] ?? ''}#${id}`;
}
