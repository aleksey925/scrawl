import { useEffect, useRef, type JSX, type RefObject } from 'react';
import { useLocation } from 'react-router';

import {
  captureFromView,
  holdPosition,
  isReadingAnchor,
  recallAnchor,
  rememberAnchor,
  restoreToView,
} from './anchor';

export interface ReadingAnchorTrackerProps {
  path: string;
  rev: string;
  // set while this arrival is placed by an anchor, so a fragment in the address yields
  placed: RefObject<boolean>;
}

const editRoute = /(?:^|\/)edit\//;

// Mounted beside a rendered note, this carries the reading position across the
// step into the editor and back. It renders a marker rather than taking an id,
// because a note heading slugged like the chrome would answer that lookup.
export function ReadingAnchorTracker({ path, rev, placed }: ReadingAnchorTrackerProps): JSX.Element {
  const marker = useRef<HTMLSpanElement>(null);
  const location = useLocation();

  useEffect(() => {
    const root = marker.current?.parentElement ?? document.body;

    const fromState = isReadingAnchor(location.state) && location.state.path === path
      ? location.state
      : undefined;
    // a position fresh from the editor beats a fragment; one replayed by a
    // reload does not, the fragment got into the address after it
    const anchor = fromState ?? recallAnchor('view', path, location.hash === '');
    placed.current = anchor !== undefined;
    const release = anchor === undefined
      ? undefined
      : holdPosition(() => restoreToView(root, anchor), window);

    const onClick = (event: MouseEvent): void => {
      const link = event.target instanceof Element ? event.target.closest('a[href]') : null;
      if (!(link instanceof HTMLAnchorElement)) {
        return;
      }
      const url = new URL(link.href, window.location.href);
      if (url.origin !== window.location.origin || !editRoute.test(url.pathname)) {
        return;
      }
      const here = captureFromView(root, path, rev);
      if (here !== undefined) {
        rememberAnchor('edit', here);
      }
    };

    document.addEventListener('click', onClick, true);
    return () => {
      release?.();
      document.removeEventListener('click', onClick, true);
    };
  }, [path, rev, placed, location.state, location.hash]);

  return <span ref={marker} hidden />;
}
