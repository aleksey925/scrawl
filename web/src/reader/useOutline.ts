import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { useLocation, useNavigate } from 'react-router';

import type { Heading } from '../api/types';
import { interactionEvents } from './position';
import { layout, layoutBreakpoints, useAtLeast } from '../theme';

import { decodeFragment, elementWithId } from './dom';
import { findParam } from './useFindOnPage';

const readingBand = 0.3;

const atTop = 4;

const scrollSlack = 1;

export interface OutlineEntry {
  id: string;
  text: string;
  level: number;
}

export interface Outline {
  entries: OutlineEntry[];
  activeId: string | null;
  select: (id: string) => void;
}

interface Page {
  scroll: number;
  maxScroll: number;
  viewport: number;
  headerHeight: number;
}

function activeIndex(tops: number[], page: Page): number {
  const band = Math.max(page.headerHeight, page.viewport * readingBand);
  let starts = tops.map((top, index) => Math.max(top - band, (tops[index - 1] ?? -Infinity) - page.headerHeight));

  const last = starts[starts.length - 1] ?? 0;
  if (last > page.maxScroll) {
    const tail = Math.max(0, page.maxScroll - (page.viewport - band));
    const squeeze = (page.maxScroll - tail) / (last - tail);
    starts = starts.map((start) => (start <= tail ? start : tail + (start - tail) * squeeze));
  }

  let res = 0;
  starts.forEach((start, index) => {
    if (start <= page.scroll + scrollSlack) {
      res = index;
    }
  });
  return res;
}

interface Pin {
  id: string;
}

function usePinned(rootRef: RefObject<HTMLDivElement | null>, html: string, entries: OutlineEntry[]): string | null {
  const location = useLocation();
  const [pin, setPin] = useState<Pin | null>(null);
  const resolved = useRef<string | null>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (root === null || resolved.current === location.key) {
      return;
    }
    if (location.hash.length < 2 || new URLSearchParams(location.search).has(findParam)) {
      resolved.current = location.key;
      setPin(null);
      return;
    }
    const target = elementWithId(root, location.hash.slice(1));
    if (target === null) {
      setPin(null);
      return;
    }
    resolved.current = location.key;
    const entry = entries.find((each) => decodeFragment(each.id) === decodeFragment(target.id));
    setPin(entry === undefined ? null : { id: entry.id });
  }, [rootRef, html, entries, location.key, location.hash, location.search]);

  useEffect(() => {
    if (pin === null) {
      return undefined;
    }
    let touched = false;
    const touch = (): void => {
      touched = true;
    };
    const onScroll = (): void => {
      if (touched) {
        setPin(null);
      }
    };
    for (const name of interactionEvents) {
      window.addEventListener(name, touch, { passive: true });
    }
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      for (const name of interactionEvents) {
        window.removeEventListener(name, touch);
      }
      window.removeEventListener('scroll', onScroll);
    };
  }, [pin]);

  return pin?.id ?? null;
}

export function useOutline(
  rootRef: RefObject<HTMLDivElement | null>,
  html: string,
  headings: Heading[] | undefined,
): Outline | null {
  const navigate = useNavigate();
  const location = useLocation();
  const compact = !useAtLeast(layoutBreakpoints.compactTopbar);
  const headerHeight = compact ? layout.topbarHeightCompact : layout.topbarHeight;
  const [spiedId, setSpiedId] = useState<string | null>(null);

  const entries = useMemo<OutlineEntry[]>(
    () => (headings ?? []).map((heading) => ({ id: heading.id, text: heading.text, level: heading.level })),
    [headings],
  );
  const pinnedId = usePinned(rootRef, html, entries);

  useEffect(() => {
    const root = rootRef.current;
    if (root === null || entries.length === 0) {
      return undefined;
    }

    const found = entries.flatMap((entry) => {
      const element = elementWithId(root, entry.id);
      return element === null ? [] : [{ id: entry.id, element }];
    });
    const first = found[0];
    if (first === undefined) {
      return undefined;
    }

    const mark = (): void => {
      if (window.scrollY < atTop) {
        setSpiedId(first.id);
        return;
      }
      const scroll = window.scrollY;
      const viewport = window.innerHeight;
      const tops = found.map((heading) => heading.element.getBoundingClientRect().top + scroll);
      const page = { scroll, viewport, headerHeight, maxScroll: document.documentElement.scrollHeight - viewport };
      setSpiedId(found[activeIndex(tops, page)]?.id ?? first.id);
    };

    let frame = 0;
    const schedule = (): void => {
      if (frame === 0) {
        frame = window.requestAnimationFrame(() => {
          frame = 0;
          mark();
        });
      }
    };

    const resized = new ResizeObserver(schedule);
    resized.observe(root);
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    mark();

    return () => {
      window.cancelAnimationFrame(frame);
      resized.disconnect();
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
    };
  }, [rootRef, html, entries, headerHeight]);

  const select = useCallback(
    (id: string): void => {
      const root = rootRef.current;
      if (root !== null) {
        elementWithId(root, id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
      void navigate({ pathname: location.pathname, search: location.search, hash: `#${id}` }, { replace: true });
    },
    [rootRef, navigate, location.pathname, location.search],
  );

  return entries.length === 0 ? null : { entries, activeId: pinnedId ?? spiedId, select };
}
