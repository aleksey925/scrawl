import { useEffect, useRef, useState, type RefObject } from 'react';

// useStuck tells whether a sticky head has reached the line it sticks to, read
// off a marker placed right above it: the marker scrolls on past that line
export function useStuck(line: number): [RefObject<HTMLDivElement | null>, boolean] {
  const marker = useRef<HTMLDivElement>(null);
  const [stuck, setStuck] = useState(false);

  useEffect(() => {
    const node = marker.current;
    if (node === null) {
      return undefined;
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry !== undefined) {
          setStuck(!entry.isIntersecting && entry.boundingClientRect.top < line);
        }
      },
      { rootMargin: `-${line}px 0px 0px 0px` },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [line]);

  return [marker, stuck];
}
