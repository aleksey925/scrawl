import { useEffect, useLayoutEffect, useState, type CSSProperties, type RefObject } from 'react';

interface VisibleArea {
  height: number;
  top: number;
}

function areaOf(): VisibleArea {
  const view = window.visualViewport;
  return view === null ? { height: window.innerHeight, top: 0 } : { height: view.height, top: view.offsetTop };
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
      setArea((prev) => (prev?.height === next.height && prev.top === next.top ? prev : next));
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
  };
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
      const keyboard = window.innerHeight - view.offsetTop - view.height > 1;
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
