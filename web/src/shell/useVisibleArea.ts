import { useEffect, useLayoutEffect, useState, type CSSProperties, type RefObject } from 'react';

function layoutHeight(): number {
  return Math.max(window.innerHeight, document.documentElement.clientHeight);
}

export function keyboardShown(view: VisualViewport): boolean {
  return layoutHeight() - view.height > 1;
}

interface VisibleArea {
  height: number;
  top: number;
  keyboard: boolean;
}

function areaOf(): VisibleArea {
  const view = window.visualViewport;
  if (view === null) {
    return { height: window.innerHeight, top: 0, keyboard: false };
  }
  return { height: view.height, top: view.offsetTop, keyboard: keyboardShown(view) };
}

function useVisibleArea(active: boolean): VisibleArea | undefined {
  const [area, setArea] = useState<VisibleArea | undefined>(undefined);

  useEffect(() => {
    if (!active) {
      setArea(undefined);
      return undefined;
    }
    const view = window.visualViewport;
    const update = (): void => {
      const next = areaOf();
      setArea((prev) => (prev?.height === next.height && prev.top === next.top && prev.keyboard === next.keyboard ? prev : next));
    };
    update();
    view?.addEventListener('resize', update);
    view?.addEventListener('scroll', update);
    return () => {
      view?.removeEventListener('resize', update);
      view?.removeEventListener('scroll', update);
    };
  }, [active]);

  return area;
}

export function useFullScreenStyle(active: boolean): CSSProperties | undefined {
  const area = useVisibleArea(active);
  if (!active) {
    return undefined;
  }
  return {
    maxHeight: 'none',
    height: area === undefined ? '100dvh' : area.height,
    transform: `translateY(${area?.top ?? 0}px)`,
    '--scrawl-screen-foot': area?.keyboard === true ? '0px' : 'env(safe-area-inset-bottom, 0px)',
  } as CSSProperties;
}

export function useVisibleScreen(screen: RefObject<HTMLElement | null>, active: boolean): void {
  useLayoutEffect(() => {
    const view = window.visualViewport;
    const element = screen.current;
    if (!active || view === null || element === null) {
      return undefined;
    }
    const root = document.documentElement.style;
    const release = (): void => {
      root.removeProperty('--scrawl-visible-height');
      root.removeProperty('--scrawl-visible-top');
    };
    const follow = (): void => {
      const keyboard = keyboardShown(view);
      element.dataset.keyboard = keyboard ? 'true' : 'false';
      if (!keyboard) {
        release();
        return;
      }
      root.setProperty('--scrawl-visible-height', `${view.height}px`);
      root.setProperty('--scrawl-visible-top', `${view.offsetTop}px`);
    };
    follow();
    view.addEventListener('resize', follow);
    view.addEventListener('scroll', follow);
    return () => {
      view.removeEventListener('resize', follow);
      view.removeEventListener('scroll', follow);
      release();
      delete element.dataset.keyboard;
    };
  }, [screen, active]);
}

const keyboardGap = 16;

export function useAboveKeyboard(target: RefObject<HTMLElement | null>): void {
  useLayoutEffect(() => {
    const view = window.visualViewport;
    const element = target.current;
    if (view === null || element === null) {
      return undefined;
    }
    const root = document.documentElement.style;
    const startY = window.scrollY;
    const bottom = element.getBoundingClientRect().bottom + startY;
    const follow = (): void => {
      if (!keyboardShown(view)) {
        root.removeProperty('--scrawl-keyboard-room');
        return;
      }
      root.setProperty('--scrawl-keyboard-room', `${layoutHeight() - view.height}px`);
      window.scrollTo({ top: Math.max(startY, bottom + keyboardGap - view.height), behavior: 'instant' });
    };
    view.addEventListener('resize', follow);
    return () => {
      view.removeEventListener('resize', follow);
      root.removeProperty('--scrawl-keyboard-room');
    };
  }, [target]);
}
