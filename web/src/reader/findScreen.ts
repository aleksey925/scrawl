import { useLayoutEffect, useRef, type RefObject } from 'react';
import { useLocation } from 'react-router';

import { followVisibleArea } from '../shell/useVisibleArea';

import { isPlainClick } from './links';

const fill = 'find';

const screenAttribute = 'data-find-screen';

interface ReadingPlace {
  node: Element;
  offset: number;
}

type Release = (restore: boolean) => void;

let centered: Element | null = null;

export function readingTop(): number {
  return document.querySelector('.mantine-AppShell-header')?.getBoundingClientRect().bottom ?? 0;
}

function readingPlace(root: HTMLElement): ReadingPlace | undefined {
  const top = readingTop();
  const node = Array.from(root.children).find((child) => child.getBoundingClientRect().bottom > top);
  return node === undefined ? undefined : { node, offset: node.getBoundingClientRect().top - top };
}

function returnTo(place: ReadingPlace | undefined, scroller: HTMLElement | Window): void {
  if (place === undefined || !place.node.isConnected) {
    return;
  }
  const delta = place.node.getBoundingClientRect().top - readingTop() - place.offset;
  if (Math.abs(delta) > 1) {
    scroller.scrollBy({ top: delta, behavior: 'instant' });
  }
}

export function pageScrolled(): boolean {
  return window.scrollY > 0 || (document.querySelector(`[data-fill="${fill}"]`)?.scrollTop ?? 0) > 0;
}

export function findScreenOf(node: Element): HTMLElement | null {
  return node.closest<HTMLElement>(`[data-fill="${fill}"]`);
}

export function centerMatch(target: Element): void {
  const screen = findScreenOf(target);
  if (screen === null) {
    target.scrollIntoView({ block: 'center', behavior: 'instant' });
    return;
  }
  centered = target;
  const box = screen.getBoundingClientRect();
  const rect = target.getBoundingClientRect();
  const top = screen.scrollTop + rect.top - box.top - (screen.clientHeight - rect.height) / 2;
  screen.scrollTo({ top, behavior: 'instant' });
  target.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
}

function leavesPage(link: HTMLAnchorElement): boolean {
  if ((link.target !== '' && link.target !== '_self') || link.hasAttribute('download')) {
    return false;
  }
  const url = new URL(link.href, window.location.href);
  return url.origin === window.location.origin && (url.pathname !== window.location.pathname || url.search !== window.location.search);
}

function enterScreen(root: HTMLElement, screen: HTMLElement): Release {
  const place = readingPlace(root);
  screen.dataset.fill = fill;
  document.documentElement.setAttribute(screenAttribute, '');
  const unfollow = followVisibleArea(screen);
  returnTo(place, screen);

  const moved = (): void => {
    centered = null;
  };
  screen.addEventListener('touchstart', moved, { passive: true });
  screen.addEventListener('wheel', moved, { passive: true });
  const resized = new ResizeObserver(() => {
    if (centered !== null && screen.contains(centered)) {
      centerMatch(centered);
    }
  });
  resized.observe(screen);
  let printed = 0;
  const beforePrint = (): void => {
    printed = screen.scrollTop;
  };
  const afterPrint = (): void => {
    screen.scrollTop = printed;
  };
  window.addEventListener('beforeprint', beforePrint);
  window.addEventListener('afterprint', afterPrint);

  let released = false;
  return (restore) => {
    if (released) {
      return;
    }
    released = true;
    resized.disconnect();
    window.removeEventListener('beforeprint', beforePrint);
    window.removeEventListener('afterprint', afterPrint);
    screen.removeEventListener('touchstart', moved);
    screen.removeEventListener('wheel', moved);
    centered = null;
    const back = restore ? readingPlace(root) : undefined;
    unfollow();
    delete screen.dataset.fill;
    document.documentElement.removeAttribute(screenAttribute);
    returnTo(back, window);
  };
}

export function useFindScreen(rootRef: RefObject<HTMLElement | null>, active: boolean, owner: string): void {
  const { pathname } = useLocation();
  const live = useRef({ owner, pathname });
  live.current = { owner, pathname };
  const unmounting = useRef(false);

  useLayoutEffect(() => {
    unmounting.current = false;
    return () => {
      unmounting.current = true;
    };
  }, []);

  useLayoutEffect(() => {
    const root = rootRef.current;
    const screen = root?.closest<HTMLElement>('[data-screen]');
    if (!active || root === null || screen === null || screen === undefined) {
      return undefined;
    }
    const entered = live.current;
    const release = enterScreen(root, screen);
    const onClick = (event: MouseEvent): void => {
      const link = event.target instanceof Element ? event.target.closest('a[href]') : null;
      if (link instanceof HTMLAnchorElement && isPlainClick(event) && leavesPage(link)) {
        release(true);
      }
    };
    document.addEventListener('click', onClick, { capture: true });
    return () => {
      document.removeEventListener('click', onClick, { capture: true });
      const now = live.current;
      release(!unmounting.current && now.owner === entered.owner && now.pathname === entered.pathname);
    };
  }, [rootRef, active, owner]);
}
