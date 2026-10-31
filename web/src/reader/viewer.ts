import { paperClass, scopeIds } from './diagramSvg';
import { imageCaption } from './dom';

const swipeMin = 40;
const tapSlop = 8;
const doubleTapMs = 300;
const maxScale = 8;
const ceilingOverActual = 2;
const keyStep = 1.5;
const pinchWheelStep = 0.01;
const wheelStepMax = 50;
const wheelLine = 16;

const chevronLeft = 'M15 6l-6 6l6 6';
const chevronRight = 'M9 6l6 6l-6 6';
const cross = 'M18 6l-12 12M6 6l12 12';

const zoomInIcon =
  'M152,112a8,8,0,0,1-8,8H120v24a8,8,0,0,1-16,0V120H80a8,8,0,0,1,0-16h24V80a8,8,0,0,1,16,0v24h24A8,8,0,0,1,152,112Zm77.66,117.66a8,8,0,0,1-11.32,0l-50.06-50.07a88.11,88.11,0,1,1,11.31-11.31l50.07,50.06A8,8,0,0,1,229.66,229.66ZM112,184a72,72,0,1,0-72-72A72.08,72.08,0,0,0,112,184Z';
const zoomOutIcon =
  'M152,112a8,8,0,0,1-8,8H80a8,8,0,0,1,0-16h64A8,8,0,0,1,152,112Zm77.66,117.66a8,8,0,0,1-11.32,0l-50.06-50.07a88.11,88.11,0,1,1,11.31-11.31l50.07,50.06A8,8,0,0,1,229.66,229.66ZM112,184a72,72,0,1,0-72-72A72.08,72.08,0,0,0,112,184Z';
const fitIcon =
  'M152,96V48a8,8,0,0,1,16,0V88h40a8,8,0,0,1,0,16H160A8,8,0,0,1,152,96ZM96,152H48a8,8,0,0,0,0,16H88v40a8,8,0,0,0,16,0V160A8,8,0,0,0,96,152Zm112,0H160a8,8,0,0,0-8,8v48a8,8,0,0,0,16,0V168h40a8,8,0,0,0,0-16ZM96,40a8,8,0,0,0-8,8V88H48a8,8,0,0,0,0,16H96a8,8,0,0,0,8-8V48A8,8,0,0,0,96,40Z';

const viewerIds = 'md-viewer';

const pixels = /^\s*(\d+(?:\.\d+)?)(?:px)?\s*$/;

type Point = { x: number; y: number };

interface PinchGesture extends UIEvent {
  scale: number;
  clientX: number;
  clientY: number;
}

type Size = { width: number; height: number };

type ViewerItem = { kind: 'image'; image: HTMLImageElement } | { kind: 'diagram'; svg: SVGSVGElement };

interface Stage {
  element: HTMLElement;
  natural: () => Size;
  shown: () => number;
  fit: () => void;
  caption: string;
}

interface Zoom {
  scale: () => number;
  zoomTo: (next: number, at: Point, glide: boolean) => void;
  panBy: (dx: number, dy: number) => void;
  toggle: (at: Point) => void;
  actual: (at: Point) => void;
  reset: () => void;
  percent: () => number;
  ceiling: () => number;
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

function phosphor(path: string): SVGSVGElement {
  const svg = icon(path);
  svg.setAttribute('viewBox', '0 0 256 256');
  svg.classList.add('md-viewer-glyph');
  return svg;
}

function button(className: string, label: string, testid: string, glyph: SVGSVGElement): HTMLButtonElement {
  const element = document.createElement('button');
  element.type = 'button';
  element.className = className;
  element.dataset.testid = testid;
  element.setAttribute('aria-label', label);
  element.append(glyph);
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

function zoomOf(stage: Stage, frame: HTMLElement, changed: () => void): Zoom {
  const content = stage.element;
  content.dataset.zoomed = 'false';
  let scale = 1;
  let shift: Point = { x: 0, y: 0 };

  const actualScale = (): number => {
    const shown = stage.shown();
    const natural = stage.natural().width;
    return shown === 0 || natural === 0 ? 1 : Math.max(1, natural / shown);
  };
  const ceiling = (): number => Math.max(maxScale, actualScale() * ceilingOverActual);
  const fittedCentre = (): Point => {
    const rect = content.getBoundingClientRect();
    return { x: rect.left + rect.width / 2 - shift.x, y: rect.top + rect.height / 2 - shift.y };
  };
  const render = (centre: Point, glide: boolean): void => {
    const room = frame.getBoundingClientRect();
    shift = {
      x: clampShift(shift.x, content.offsetWidth * scale, centre.x - room.left, room.width),
      y: clampShift(shift.y, content.offsetHeight * scale, centre.y - room.top, room.height),
    };
    content.classList.toggle('md-viewer-glide', glide);
    content.style.transform = scale === 1 ? '' : `translate(${shift.x}px, ${shift.y}px) scale(${scale})`;
    content.dataset.zoomed = String(scale > 1);
    changed();
  };
  const zoomTo = (next: number, at: Point, glide: boolean): void => {
    const centre = fittedCentre();
    const target = Math.min(ceiling(), Math.max(1, next));
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
      zoomTo(scale > 1 ? 1 : Math.max(2, actualScale()), at, true);
    },
    actual: (at) => {
      zoomTo(actualScale(), at, true);
    },
    reset: () => {
      scale = 1;
      shift = { x: 0, y: 0 };
      content.classList.remove('md-viewer-glide');
      content.style.transform = '';
      content.dataset.zoomed = 'false';
      changed();
    },
    percent: () => {
      const natural = stage.natural().width;
      return natural === 0 ? 100 : Math.round((scale * stage.shown() * 100) / natural);
    },
    ceiling,
  };
}

function layoutBox(element: HTMLElement): Size {
  const style = getComputedStyle(element);
  return { width: Number.parseFloat(style.width) || 0, height: Number.parseFloat(style.height) || 0 };
}

function containedWidth(natural: Size, box: Size): number {
  if (natural.width === 0 || natural.height === 0) {
    return box.width;
  }
  return natural.width * Math.min(box.width / natural.width, box.height / natural.height);
}

function imageStage(image: HTMLImageElement, loaded: () => void): Stage {
  const picture = document.createElement('img');
  picture.className = 'md-viewer-image';
  picture.dataset.testid = 'doc-lightbox-image';
  picture.draggable = false;
  picture.addEventListener('load', loaded);
  picture.src = sourceOf(image);
  picture.alt = image.alt;
  return {
    element: picture,
    natural: () => ({ width: picture.naturalWidth, height: picture.naturalHeight }),
    shown: () =>
      containedWidth(
        { width: picture.naturalWidth, height: picture.naturalHeight },
        layoutBox(picture),
      ),
    fit: () => {},
    caption: imageCaption(image),
  };
}

function lengthOf(svg: SVGSVGElement, name: 'width' | 'height'): number {
  const given = Number(pixels.exec(svg.getAttribute(name) ?? '')?.[1]);
  if (given > 0) {
    return given;
  }
  const box = svg.viewBox.baseVal;
  return box === null ? 0 : box[name];
}

function contentBox(element: HTMLElement): Size {
  const style = getComputedStyle(element);
  const across = Number.parseFloat(style.paddingLeft) + Number.parseFloat(style.paddingRight);
  const down = Number.parseFloat(style.paddingTop) + Number.parseFloat(style.paddingBottom);
  return { width: element.clientWidth - across, height: element.clientHeight - down };
}

function diagramStage(svg: SVGSVGElement, room: HTMLElement): Stage {
  const natural = { width: lengthOf(svg, 'width'), height: lengthOf(svg, 'height') };
  const sheet = document.createElement('div');
  sheet.className = 'md-viewer-image md-viewer-sheet';
  sheet.dataset.testid = 'doc-lightbox-diagram';
  sheet.dataset.paper = String(svg.classList.contains(paperClass));
  const drawing = svg.cloneNode(true) as SVGSVGElement;
  scopeIds(drawing, viewerIds);
  drawing.classList.remove(paperClass);
  drawing.style.removeProperty('max-width');
  sheet.append(drawing);
  return {
    element: sheet,
    natural: () => natural,
    shown: () => lengthOf(drawing, 'width'),
    fit: () => {
      const space = contentBox(room);
      const gutter = contentBox(sheet);
      const across = sheet.offsetWidth - gutter.width;
      const down = sheet.offsetHeight - gutter.height;
      const ratio =
        natural.width === 0 || natural.height === 0
          ? 1
          : Math.min(1, (space.width - across) / natural.width, (space.height - down) / natural.height);
      const width = Math.max(1, natural.width * ratio);
      const height = Math.max(1, natural.height * ratio);
      drawing.setAttribute('width', String(width));
      drawing.setAttribute('height', String(height));
      drawing.style.width = `${width}px`;
      drawing.style.height = `${height}px`;
    },
    caption: '',
  };
}

function openItems(items: readonly ViewerItem[], start: number, label: string): () => void {
  let at = Math.min(Math.max(0, start), items.length - 1);
  const opened = items[at];
  if (opened === undefined) {
    return () => {};
  }

  const dialog = document.createElement('dialog');
  dialog.className = 'md-viewer';
  dialog.dataset.testid = 'doc-lightbox';
  dialog.setAttribute('aria-label', label);

  const caption = document.createElement('p');
  caption.className = 'md-viewer-caption';
  caption.dataset.testid = 'doc-lightbox-caption';
  const count = document.createElement('p');
  count.className = 'md-viewer-count';
  count.dataset.testid = 'doc-lightbox-count';
  const close = button('md-viewer-close', 'Close the viewer', 'doc-lightbox-close', icon(cross));
  const previous = button('md-viewer-step md-viewer-previous', 'Previous', 'doc-lightbox-previous', icon(chevronLeft));
  const next = button('md-viewer-step md-viewer-next', 'Next', 'doc-lightbox-next', icon(chevronRight));

  const tools = document.createElement('div');
  tools.className = 'md-viewer-tools';
  const zoomOut = button('md-viewer-tool', 'Zoom out', 'doc-lightbox-zoom-out', phosphor(zoomOutIcon));
  const percent = document.createElement('button');
  percent.type = 'button';
  percent.className = 'md-viewer-tool md-viewer-percent';
  percent.dataset.testid = 'doc-lightbox-zoom';
  percent.setAttribute('aria-label', 'Actual size');
  const zoomIn = button('md-viewer-tool', 'Zoom in', 'doc-lightbox-zoom-in', phosphor(zoomInIcon));
  const fit = button('md-viewer-tool', 'Fit to the screen', 'doc-lightbox-fit', phosphor(fitIcon));
  tools.append(zoomOut, percent, zoomIn, fit);

  const several = items.length > 1;
  dialog.append(caption, tools, close);
  if (several) {
    dialog.append(previous, next, count);
  }

  const centre = (): Point => ({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
  const refresh = (): void => {
    const scale = zoom.scale();
    percent.textContent = `${zoom.percent()}%`;
    zoomOut.disabled = scale <= 1;
    fit.disabled = scale <= 1;
    zoomIn.disabled = scale >= zoom.ceiling();
  };
  const stageOf = (item: ViewerItem): Stage =>
    item.kind === 'image' ? imageStage(item.image, refresh) : diagramStage(item.svg, dialog);
  let stage = stageOf(opened);
  let zoom = zoomOf(stage, dialog, refresh);
  dialog.prepend(stage.element);
  const present = (): void => {
    caption.textContent = stage.caption;
    caption.hidden = stage.caption === '';
    count.textContent = `${at + 1} / ${items.length}`;
    stage.fit();
    refresh();
  };
  const step = (delta: number): void => {
    at = (at + delta + items.length) % items.length;
    const item = items[at];
    if (item === undefined) {
      return;
    }
    const built = stageOf(item);
    stage.element.replaceWith(built.element);
    stage = built;
    zoom = zoomOf(built, dialog, refresh);
    present();
  };
  const onResize = (): void => {
    stage.fit();
    zoom.reset();
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

  const tapStage = (point: Point): void => {
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
    const target = event.target instanceof Element ? event.target : null;
    const pressed = target?.closest('button') ?? null;
    if (pressed === previous) {
      step(-1);
    } else if (pressed === next) {
      step(1);
    } else if (pressed === close) {
      dialog.close();
    } else if (pressed === zoomIn) {
      zoom.zoomTo(zoom.scale() * keyStep, centre(), true);
    } else if (pressed === zoomOut) {
      zoom.zoomTo(zoom.scale() / keyStep, centre(), true);
    } else if (pressed === percent) {
      zoom.actual(centre());
    } else if (pressed === fit) {
      zoom.zoomTo(1, centre(), true);
    } else if (pressed !== null || target?.closest('a') != null) {
      return;
    } else if (gesture.pinched || gesture.travel > tapSlop) {
      return;
    } else if (target !== null && stage.element.contains(target)) {
      tapStage(pointOf(event));
    } else if (target === null || !tools.contains(target)) {
      dialog.close();
    }
  });
  dialog.addEventListener(
    'wheel',
    (event) => {
      event.preventDefault();
      const unit = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? wheelLine : 1;
      if (event.ctrlKey || event.metaKey) {
        const delta = Math.max(-wheelStepMax, Math.min(wheelStepMax, event.deltaY * unit));
        zoom.zoomTo(zoom.scale() * Math.exp(-delta * pinchWheelStep), pointOf(event), false);
        return;
      }
      const across = event.shiftKey && event.deltaX === 0 ? event.deltaY : event.deltaX;
      const down = event.shiftKey && event.deltaX === 0 ? 0 : event.deltaY;
      zoom.panBy(-across * unit, -down * unit);
    },
    { passive: false },
  );
  let pinchFrom = 1;
  dialog.addEventListener('gesturestart', (event) => {
    event.preventDefault();
    pinchFrom = zoom.scale();
  });
  dialog.addEventListener('gesturechange', (event) => {
    event.preventDefault();
    if (pointers.size > 0) {
      return;
    }
    const pinch = event as PinchGesture;
    zoom.zoomTo(pinchFrom * pinch.scale, { x: pinch.clientX, y: pinch.clientY }, false);
  });
  dialog.addEventListener('gestureend', (event) => {
    event.preventDefault();
  });
  dialog.addEventListener('keydown', (event) => {
    if (several && event.key === 'ArrowRight') {
      step(1);
    }
    if (several && event.key === 'ArrowLeft') {
      step(-1);
    }
    if (event.key === '+' || event.key === '=') {
      zoom.zoomTo(zoom.scale() * keyStep, centre(), true);
    }
    if (event.key === '-') {
      zoom.zoomTo(zoom.scale() / keyStep, centre(), true);
    }
    if (event.key === '0') {
      zoom.zoomTo(1, centre(), true);
    }
    if (event.key === '1') {
      zoom.actual(centre());
    }
  });

  const scroll = document.documentElement.style.overflow;
  dialog.addEventListener('close', () => {
    window.removeEventListener('resize', onResize);
    document.documentElement.style.overflow = scroll;
    dialog.remove();
  });

  document.body.append(dialog);
  document.documentElement.style.overflow = 'hidden';
  dialog.showModal();
  present();
  window.addEventListener('resize', onResize);
  close.focus();
  return () => {
    dialog.close();
  };
}

export function openViewer(images: readonly HTMLImageElement[], start: HTMLImageElement): () => void {
  const items = images.map((entry): ViewerItem => ({ kind: 'image', image: entry }));
  return openItems(items, images.indexOf(start), 'Image viewer');
}

export function openDiagramViewer(svg: SVGSVGElement): () => void {
  return openItems([{ kind: 'diagram', svg }], 0, 'Diagram viewer');
}
