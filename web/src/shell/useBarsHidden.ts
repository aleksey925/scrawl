import { useEffect } from 'react';

// barsAttribute is set on the root while scrolling down has put the controls
// at the bottom of a phone away
export const barsAttribute = 'data-scrawl-bars';

const threshold = 8;

// useBarsHidden hides what sits at the bottom of a phone while the page scrolls
// down and brings it back on the way up, so a note being read has the screen
export function useBarsHidden(): void {
  useEffect(() => {
    const root = document.documentElement;
    let last = window.scrollY;
    const onScroll = (): void => {
      const y = window.scrollY;
      if (y <= 0) {
        root.removeAttribute(barsAttribute);
      } else if (y - last > threshold) {
        root.setAttribute(barsAttribute, 'hidden');
      } else if (last - y > threshold) {
        root.removeAttribute(barsAttribute);
      } else {
        return;
      }
      last = y;
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      root.removeAttribute(barsAttribute);
    };
  }, []);
}
