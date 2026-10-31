import { useEffect, useRef, type JSX, type RefObject } from 'react';
import { useLocation } from 'react-router';

import { holdPosition } from '../reader/position';

import {
  captureFromView,
  isReadingAnchor,
  recallAnchor,
  rememberAnchor,
  restoreToView,
} from './anchor';

export interface ReadingAnchorTrackerProps {
  path: string;
  rev: string;
  placed: RefObject<boolean>;
}

const editRoute = /(?:^|\/)edit\//;

export function ReadingAnchorTracker({ path, rev, placed }: ReadingAnchorTrackerProps): JSX.Element {
  const marker = useRef<HTMLSpanElement>(null);
  const location = useLocation();

  useEffect(() => {
    const root = marker.current?.parentElement ?? document.body;

    const fromState = isReadingAnchor(location.state) && location.state.path === path
      ? location.state
      : undefined;
    const anchor = fromState ?? recallAnchor('view', path, location.hash === '');
    placed.current = anchor !== undefined;
    let placedAt: number | undefined;
    const release = anchor === undefined
      ? undefined
      : holdPosition(() => {
        if (restoreToView(root, anchor)) {
          placedAt = window.scrollY;
        }
      }, window);

    const onClick = (event: MouseEvent): void => {
      const link = event.target instanceof Element ? event.target.closest('a[href]') : null;
      if (!(link instanceof HTMLAnchorElement)) {
        return;
      }
      const url = new URL(link.href, window.location.href);
      if (url.origin !== window.location.origin || !editRoute.test(url.pathname)) {
        return;
      }
      const unmoved = placedAt !== undefined && Math.abs(window.scrollY - placedAt) < 1;
      const here = anchor !== undefined && unmoved ? { ...anchor, rev } : captureFromView(root, path, rev);
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
