import { useEffect, useRef, type RefObject } from 'react';
import { useLocation } from 'react-router';

import { holdPosition } from '../editor/anchor';

import { elementWithId } from './dom';
import { findParam } from './useFindOnPage';

// The browser looks for the fragment when the shell loads, before the note is
// on the page, and never looks again. So the note does it once it has arrived.
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
    // once per arrival: the same note rendered again must not pull the reader
    // back to the heading they have since scrolled away from
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
