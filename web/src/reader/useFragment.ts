import { useEffect, useRef, type RefObject } from 'react';
import { useLocation } from 'react-router';

import { holdPosition } from './position';

import { elementWithId } from './dom';
import { findParam } from './useFindOnPage';

export function useFragment(
  rootRef: RefObject<HTMLDivElement | null>,
  html: string,
  placed: RefObject<boolean> | undefined,
): void {
  const location = useLocation();

  const latest = useRef(location);
  useEffect(() => {
    latest.current = location;
  });

  const landedOn = useRef<string | null>(null);

  useEffect(() => {
    const root = rootRef.current;
    const { pathname, search, hash } = latest.current;
    if (root === null || landedOn.current === pathname) {
      return undefined;
    }
    landedOn.current = pathname;

    if (hash.length < 2 || new URLSearchParams(search).has(findParam)) {
      return undefined;
    }
    const target = elementWithId(root, hash.slice(1));
    if (target === null) {
      return undefined;
    }

    const land = (): void => {
      if (placed?.current !== true) {
        target.scrollIntoView({ behavior: 'instant', block: 'start' });
      }
    };
    land();
    return holdPosition(land, window);
  }, [rootRef, html, placed]);
}
