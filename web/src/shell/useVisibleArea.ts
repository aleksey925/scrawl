import { useEffect, useState } from 'react';

export interface VisibleArea {
  height: number;
  top: number;
}

function areaOf(): VisibleArea {
  const view = window.visualViewport;
  return view === null ? { height: window.innerHeight, top: 0 } : { height: view.height, top: view.offsetTop };
}

// useVisibleArea is the part of the screen the keyboard leaves free. A phone's
// keyboard covers the bottom of the page without making it any shorter, so a
// field kept at the bottom would sit under the keys.
export function useVisibleArea(active: boolean): VisibleArea | undefined {
  const [area, setArea] = useState<VisibleArea | undefined>(undefined);

  useEffect(() => {
    if (!active) {
      setArea(undefined);
      return undefined;
    }
    const view = window.visualViewport;
    const update = (): void => setArea(areaOf());
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
