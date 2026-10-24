import { imageCaption } from './dom';

const swipeMin = 40;

const chevronLeft = 'M15 6l-6 6l6 6';
const chevronRight = 'M9 6l6 6l-6 6';
const cross = 'M18 6l-12 12M6 6l12 12';

function icon(path: string): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  const line = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  line.setAttribute('d', path);
  svg.append(line);
  return svg;
}

function button(className: string, label: string, testid: string, path: string): HTMLButtonElement {
  const element = document.createElement('button');
  element.type = 'button';
  element.className = className;
  element.dataset.testid = testid;
  element.setAttribute('aria-label', label);
  element.append(icon(path));
  return element;
}

function sourceOf(image: HTMLImageElement): string {
  return image.currentSrc === '' ? image.src : image.currentSrc;
}

export function openViewer(images: readonly HTMLImageElement[], start: HTMLImageElement): () => void {
  let at = Math.max(0, images.indexOf(start));

  const dialog = document.createElement('dialog');
  dialog.className = 'md-viewer';
  dialog.dataset.testid = 'doc-lightbox';
  dialog.setAttribute('aria-label', 'Image viewer');

  const picture = document.createElement('img');
  picture.className = 'md-viewer-image';
  picture.dataset.testid = 'doc-lightbox-image';
  const caption = document.createElement('p');
  caption.className = 'md-viewer-caption';
  caption.dataset.testid = 'doc-lightbox-caption';
  const count = document.createElement('p');
  count.className = 'md-viewer-count';
  count.dataset.testid = 'doc-lightbox-count';
  const close = button('md-viewer-close', 'Close the image', 'doc-lightbox-close', cross);
  const previous = button('md-viewer-step md-viewer-previous', 'Previous image', 'doc-lightbox-previous', chevronLeft);
  const next = button('md-viewer-step md-viewer-next', 'Next image', 'doc-lightbox-next', chevronRight);

  const several = images.length > 1;
  dialog.append(picture, caption, close);
  if (several) {
    dialog.append(previous, next, count);
  }

  const show = (): void => {
    const image = images[at];
    if (image === undefined) {
      return;
    }
    picture.src = sourceOf(image);
    picture.alt = image.alt;
    caption.textContent = imageCaption(image);
    count.textContent = `${at + 1} / ${images.length}`;
  };
  const step = (delta: number): void => {
    at = (at + delta + images.length) % images.length;
    show();
  };

  let from: { x: number; y: number } | null = null;
  let swiped = false;
  dialog.addEventListener('pointerdown', (event) => {
    from = { x: event.clientX, y: event.clientY };
    swiped = false;
  });
  dialog.addEventListener('pointerup', (event) => {
    const start = from;
    from = null;
    if (start === null || !several) {
      return;
    }
    const moved = event.clientX - start.x;
    if (Math.abs(moved) < swipeMin || Math.abs(moved) <= Math.abs(event.clientY - start.y)) {
      return;
    }
    swiped = true;
    step(moved < 0 ? 1 : -1);
  });

  dialog.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target.closest('button') : null;
    if (target === previous) {
      step(-1);
    } else if (target === next) {
      step(1);
    } else if (!swiped) {
      dialog.close();
    }
    swiped = false;
  });
  dialog.addEventListener('keydown', (event) => {
    if (several && event.key === 'ArrowRight') {
      step(1);
    }
    if (several && event.key === 'ArrowLeft') {
      step(-1);
    }
  });

  const scroll = document.documentElement.style.overflow;
  dialog.addEventListener('close', () => {
    document.documentElement.style.overflow = scroll;
    dialog.remove();
  });

  show();
  document.body.append(dialog);
  document.documentElement.style.overflow = 'hidden';
  dialog.showModal();
  close.focus();
  return () => {
    dialog.close();
  };
}
