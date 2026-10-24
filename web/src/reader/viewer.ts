import { imageCaption } from './dom';

const swipeMin = 40;
const tapSlop = 8;
const doubleTapMs = 300;
const maxScale = 8;
const keyStep = 1.5;
const wheelStep = 0.002;
const pinchWheelStep = 0.01;
const wheelLine = 16;

const chevronLeft = 'M15 6l-6 6l6 6';
const chevronRight = 'M9 6l6 6l-6 6';
const cross = 'M18 6l-12 12M6 6l12 12';

type Point = { x: number; y: number };

interface Zoom {
  scale: () => number;
  zoomTo: (next: number, at: Point, glide: boolean) => void;
  panBy: (dx: number, dy: number) => void;
  toggle: (at: Point) => void;
  reset: () => void;
}

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

function pointOf(event: MouseEvent): Point {
  return { x: event.clientX, y: event.clientY };
}

function middle(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function clampShift(value: number, size: number, centre: number, room: number): number {
  if (size <= room) {
    return 0;
  }
  return Math.min(size / 2 - centre, Math.max(room - centre - size / 2, value));
}

function zoomOf(picture: HTMLImageElement, frame: HTMLElement): Zoom {
  let scale = 1;
  let shift: Point = { x: 0, y: 0 };

  const fittedCentre = (): Point => {
    const rect = picture.getBoundingClientRect();
    return { x: rect.left + rect.width / 2 - shift.x, y: rect.top + rect.height / 2 - shift.y };
  };
  const render = (centre: Point, glide: boolean): void => {
    const room = frame.getBoundingClientRect();
    shift = {
      x: clampShift(shift.x, picture.offsetWidth * scale, centre.x - room.left, room.width),
      y: clampShift(shift.y, picture.offsetHeight * scale, centre.y - room.top, room.height),
    };
    picture.classList.toggle('md-viewer-glide', glide);
    picture.style.transform = scale === 1 ? '' : `translate(${shift.x}px, ${shift.y}px) scale(${scale})`;
    picture.dataset.zoomed = String(scale > 1);
  };
  const zoomTo = (next: number, at: Point, glide: boolean): void => {
    const centre = fittedCentre();
    const target = Math.min(maxScale, Math.max(1, next));
    shift = {
      x: at.x - centre.x - ((at.x - centre.x - shift.x) * target) / scale,
      y: at.y - centre.y - ((at.y - centre.y - shift.y) * target) / scale,
    };
    scale = target;
    render(centre, glide);
  };

  return {
    scale: () => scale,
    zoomTo,
    panBy: (dx, dy) => {
      const centre = fittedCentre();
      shift = { x: shift.x + dx, y: shift.y + dy };
      render(centre, false);
    },
    toggle: (at) => {
      const full = picture.offsetWidth === 0 ? 2 : Math.max(2, picture.naturalWidth / picture.offsetWidth);
      zoomTo(scale > 1 ? 1 : full, at, true);
    },
    reset: () => {
      scale = 1;
      shift = { x: 0, y: 0 };
      picture.classList.remove('md-viewer-glide');
      picture.style.transform = '';
      picture.dataset.zoomed = 'false';
    },
  };
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
  picture.draggable = false;
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

  const zoom = zoomOf(picture, dialog);
  const show = (): void => {
    const image = images[at];
    if (image === undefined) {
      return;
    }
    zoom.reset();
    picture.src = sourceOf(image);
    picture.alt = image.alt;
    caption.textContent = imageCaption(image);
    count.textContent = `${at + 1} / ${images.length}`;
  };
  const step = (delta: number): void => {
    at = (at + delta + images.length) % images.length;
    show();
  };

  const pointers = new Map<number, Point>();
  let gesture = { from: { x: 0, y: 0 }, travel: 0, pinched: false, touch: false };
  let lastTap: { time: number; point: Point } | null = null;

  dialog.addEventListener('pointerdown', (event) => {
    pointers.set(event.pointerId, pointOf(event));
    if (pointers.size === 1) {
      gesture = { from: pointOf(event), travel: 0, pinched: false, touch: event.pointerType === 'touch' };
    } else {
      gesture.pinched = true;
    }
  });
  dialog.addEventListener('pointermove', (event) => {
    const last = pointers.get(event.pointerId);
    if (last === undefined) {
      return;
    }
    const now = pointOf(event);
    const [first, second] = Array.from(pointers.values());
    pointers.set(event.pointerId, now);
    gesture.travel += distance(last, now);
    if (first !== undefined && second !== undefined) {
      const [movedFirst, movedSecond] = Array.from(pointers.values());
      if (movedFirst === undefined || movedSecond === undefined) {
        return;
      }
      const before = middle(first, second);
      const after = middle(movedFirst, movedSecond);
      const spread = distance(first, second);
      if (spread > 0) {
        zoom.zoomTo((zoom.scale() * distance(movedFirst, movedSecond)) / spread, before, false);
      }
      zoom.panBy(after.x - before.x, after.y - before.y);
    } else if (zoom.scale() > 1) {
      if (gesture.travel > tapSlop && !dialog.hasPointerCapture(event.pointerId)) {
        dialog.setPointerCapture(event.pointerId);
      }
      zoom.panBy(now.x - last.x, now.y - last.y);
    }
  });
  const release = (event: PointerEvent): void => {
    pointers.delete(event.pointerId);
  };
  dialog.addEventListener('pointercancel', release);
  dialog.addEventListener('pointerup', (event) => {
    release(event);
    if (pointers.size > 0 || gesture.pinched || zoom.scale() > 1 || !several) {
      return;
    }
    const moved = event.clientX - gesture.from.x;
    if (Math.abs(moved) < swipeMin || Math.abs(moved) <= Math.abs(event.clientY - gesture.from.y)) {
      return;
    }
    step(moved < 0 ? 1 : -1);
  });

  const tapPicture = (point: Point): void => {
    if (!gesture.touch) {
      zoom.toggle(point);
      return;
    }
    const now = performance.now();
    if (lastTap !== null && now - lastTap.time < doubleTapMs && distance(lastTap.point, point) < swipeMin) {
      lastTap = null;
      zoom.toggle(point);
      return;
    }
    lastTap = { time: now, point };
  };

  dialog.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target.closest('button') : null;
    if (target === previous) {
      step(-1);
    } else if (target === next) {
      step(1);
    } else if (target === close) {
      dialog.close();
    } else if (gesture.pinched || gesture.travel > tapSlop) {
      return;
    } else if (event.target === picture) {
      tapPicture(pointOf(event));
    } else {
      dialog.close();
    }
  });
  dialog.addEventListener(
    'wheel',
    (event) => {
      event.preventDefault();
      const delta = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? event.deltaY * wheelLine : event.deltaY;
      const rate = event.ctrlKey ? pinchWheelStep : wheelStep;
      zoom.zoomTo(zoom.scale() * Math.exp(-delta * rate), pointOf(event), false);
    },
    { passive: false },
  );
  dialog.addEventListener('keydown', (event) => {
    const centre = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
    if (several && event.key === 'ArrowRight') {
      step(1);
    }
    if (several && event.key === 'ArrowLeft') {
      step(-1);
    }
    if (event.key === '+' || event.key === '=') {
      zoom.zoomTo(zoom.scale() * keyStep, centre, true);
    }
    if (event.key === '-') {
      zoom.zoomTo(zoom.scale() / keyStep, centre, true);
    }
    if (event.key === '0') {
      zoom.zoomTo(1, centre, true);
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
