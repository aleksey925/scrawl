import { useEffect, useState, type CSSProperties } from 'react';

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
    let frame = 0;
    const update = (): void => {
      frame = 0;
      const next = areaOf();
      setArea((prev) => (prev?.height === next.height && prev.top === next.top ? prev : next));
    };
    const schedule = (): void => {
      if (frame === 0) {
        frame = window.requestAnimationFrame(update);
      }
    };
    update();
    view?.addEventListener('resize', schedule);
    view?.addEventListener('scroll', schedule);
    return () => {
      window.cancelAnimationFrame(frame);
      view?.removeEventListener('resize', schedule);
      view?.removeEventListener('scroll', schedule);
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
