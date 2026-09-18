import { useEffect, useRef, type JSX } from 'react';
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
}

const editRoute = /(?:^|\/)edit\//;

// Mounted beside a rendered note, this carries the reading position across the
// step into the editor and back. It renders a marker rather than taking an id,
// because a note heading slugged like the chrome would answer that lookup.
export function ReadingAnchorTracker({ path, rev }: ReadingAnchorTrackerProps): JSX.Element {
  const marker = useRef<HTMLSpanElement>(null);
  const location = useLocation();

  useEffect(() => {
    const root = marker.current?.parentElement ?? document.body;

    const fromState = isReadingAnchor(location.state) && location.state.path === path
      ? location.state
      : undefined;
    const anchor = fromState ?? recallAnchor('view', path);
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
  }, [path, rev, location.state]);

  return <span ref={marker} hidden />;
}
