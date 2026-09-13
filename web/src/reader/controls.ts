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

  for (const heading of headingsOf(root)) {
    if (heading.querySelector(`.${anchorClass}`) !== null) {
      continue;
    }
    const anchor = document.createElement('a');
    anchor.className = anchorClass;
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
    const button = document.createElement('button');
    button.type = 'button';
    button.className = copyClass;
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
    prepared.push(image);
  }

  return () => {
    for (const node of added) {
      node.remove();
    }
    for (const image of prepared) {
      image.removeAttribute('tabindex');
      image.removeAttribute('role');
      image.removeAttribute('aria-label');
    }
  };
}
