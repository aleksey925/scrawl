import { headingsOf, imagesOf } from './dom';

export const anchorClass = 'md-anchor';
export const copyClass = 'md-copy';
export const copyLabel = 'Copy';
export const copiedLabel = 'Copied';

// injectControls adds the reading controls the server does not render and
// returns the teardown, because React never owns anything inside injected html
export function injectControls(root: HTMLElement): () => void {
  const added: HTMLElement[] = [];
  const prepared: HTMLImageElement[] = [];
  const tagged: HTMLElement[] = [];

  // note html is the reader's own, so every hook this puts on it is taken back
  // off again: React never owns anything in here to re-render it away
  const tag = (element: HTMLElement, testid: string): void => {
    element.dataset.testid = testid;
    tagged.push(element);
  };

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
    anchor.textContent = '#';
    heading.append(anchor);
    added.push(anchor);
  }

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

  // the zoom is advertised with cursor: zoom-in, which only a pointer sees, so
  // the image carries the role and takes a key press of its own
  for (const image of imagesOf(root)) {
    image.tabIndex = 0;
    image.setAttribute('role', 'button');
    image.setAttribute('aria-label', image.alt === '' ? 'Open image' : `Open image: ${image.alt}`);
    tag(image, 'doc-image');
    prepared.push(image);
  }

  return () => {
    for (const node of added) {
      node.remove();
    }
    for (const node of tagged) {
      delete node.dataset.testid;
    }
    for (const image of prepared) {
      image.removeAttribute('tabindex');
      image.removeAttribute('role');
      image.removeAttribute('aria-label');
    }
  };
}
