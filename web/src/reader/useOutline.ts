import { useCallback, useEffect, useMemo, useState, type RefObject } from 'react';
import { useLocation, useNavigate } from 'react-router';

import type { Heading } from '../api/types';
import { layout, layoutBreakpoints, useAtLeast } from '../theme';

import { elementWithId } from './dom';

// how much of the viewport counts as "being read": the band ends well above the
// fold, so a heading is active while its section is under the reader's eyes
const readingBand = '-70%';

const atTop = 4;

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

export function useOutline(
  rootRef: RefObject<HTMLDivElement | null>,
  html: string,
  headings: Heading[] | undefined,
): Outline | null {
  const navigate = useNavigate();
  const location = useLocation();
  const compact = !useAtLeast(layoutBreakpoints.compactTopbar);
  const headerHeight = compact ? layout.topbarHeightCompact : layout.topbarHeight;
  const [activeId, setActiveId] = useState<string | null>(null);

  const entries = useMemo<OutlineEntry[]>(
    () => (headings ?? []).map((heading) => ({ id: heading.id, text: heading.text, level: heading.level })),
    [headings],
  );

  useEffect(() => {
    const root = rootRef.current;
    if (root === null || entries.length === 0) {
      return undefined;
    }

    const ids = new Map<Element, string>();
    const ordered: Element[] = [];
    for (const entry of entries) {
      const element = elementWithId(root, entry.id);
      if (element === null) {
        continue;
      }
      ids.set(element, entry.id);
      ordered.push(element);
    }
    if (ordered.length === 0) {
      return undefined;
    }

    const seen = new Set<Element>();

    // lastPassed is the section the reader is inside when no heading is in the
    // band at all: a section longer than the band, or a jump that carried
    // several headings past it between two frames. Without it the marker stays
    // on whatever was in the band last and the outline stops following.
    const lastPassed = (): Element | undefined => {
      let res: Element | undefined;
      for (const target of ordered) {
        if (target.getBoundingClientRect().top > headerHeight) {
          break;
        }
        res = target;
      }
      return res;
    };

    const mark = (): void => {
      // at the top of the page the first heading is usually still below the
      // band, which would leave the outline blank until the reader scrolls
      if (window.scrollY < atTop) {
        setActiveId(ids.get(ordered[0] as Element) ?? null);
        return;
      }
      const active = ordered.find((target) => seen.has(target)) ?? lastPassed();
      if (active !== undefined) {
        setActiveId(ids.get(active) ?? null);
      }
    };

    const observer = new IntersectionObserver(
      (records) => {
        for (const record of records) {
          if (record.isIntersecting) {
            seen.add(record.target);
          } else {
            seen.delete(record.target);
          }
        }
        mark();
      },
      { rootMargin: `-${headerHeight}px 0px ${readingBand} 0px` },
    );
    for (const target of ordered) {
      observer.observe(target);
    }
    mark();

    return () => observer.disconnect();
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

  return entries.length === 0 ? null : { entries, activeId, select };
}
