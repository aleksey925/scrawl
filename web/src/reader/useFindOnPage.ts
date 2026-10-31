import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router';

import { usePlatform } from '../platform';

import { blocksOf, markMatches, matchAtLine, reveal, unmark } from './findDom';
import { FindTimeout, patternOf, togglesOf, type FindPattern, type FindQuery } from './findMatches';

export const findParam = 'q';
const findParams = [findParam, 'case', 'word', 'regex', 'line'] as const;

const typingDelayMs = 150;

export type FindStatus = 'idle' | 'found' | 'none' | 'bad' | 'slow';

export interface FindOnPage {
  opened: boolean;
  openings: number;
  query: FindQuery;
  status: FindStatus;
  position: number;
  total: number;
  open: (text?: string) => void;
  setQuery: (query: FindQuery) => void;
  run: () => void;
  step: (delta: number) => void;
  close: () => void;
}

const emptyQuery: FindQuery = { text: '', matchCase: false, word: false, regex: false };

function queryOf(params: URLSearchParams): FindQuery | undefined {
  const text = params.get(findParam);
  if (text === null || text === '') {
    return undefined;
  }
  return { text, ...togglesOf(params) };
}

export function useFindOnPage(rootRef: RefObject<HTMLDivElement | null>, html: string): FindOnPage {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { runFind, boundedFind } = usePlatform();

  const [opened, setOpened] = useState(false);
  const [openings, setOpenings] = useState(0);
  const [query, setQueryState] = useState<FindQuery>(emptyQuery);
  const [armed, setArmed] = useState(true);
  const [status, setStatus] = useState<FindStatus>('idle');
  const [index, setIndex] = useState(0);
  const [total, setTotal] = useState(0);
  const groups = useRef<HTMLElement[][]>([]);
  const line = useRef<number | undefined>(undefined);

  const fromUrl = queryOf(searchParams);
  const address = `${location.pathname}?${searchParams.toString()}`;
  const readFor = useRef<{ address: string; html: string; again: boolean } | undefined>(undefined);
  useEffect(() => {
    const last = readFor.current;
    const fresh = last === undefined || last.address !== address;
    if (!fresh && !(last.again && last.html !== html)) {
      return;
    }
    readFor.current = { address, html, again: fresh };
    if (fromUrl === undefined) {
      if (fresh) {
        line.current = undefined;
        setOpened(false);
        setQueryState(emptyQuery);
      }
      return;
    }
    const wanted = Number(searchParams.get('line'));
    line.current = Number.isInteger(wanted) && wanted > 0 ? wanted : undefined;
    setQueryState(fromUrl);
    setArmed(boundedFind || !fromUrl.regex);
    setOpened(true);
  }, [address, html]);

  const show = useCallback((at: number, scroll: boolean): void => {
    const found = groups.current;
    if (found.length === 0) {
      return;
    }
    const next = ((at % found.length) + found.length) % found.length;
    found.forEach((group, position) => {
      for (const mark of group) {
        mark.dataset.active = position === next ? 'true' : 'false';
      }
    });
    const first = found[next]?.[0];
    if (first !== undefined && scroll) {
      reveal(first);
      first.scrollIntoView({ block: 'center', behavior: 'instant' });
    }
    setIndex(next);
  }, []);

  useEffect(() => {
    const root = rootRef.current;
    if (root === null || !opened || !armed || query.text === '') {
      setStatus('idle');
      setTotal(0);
      return undefined;
    }

    let stale = false;
    let marked: HTMLElement[][] = [];
    const replaced = new AbortController();
    const timer = window.setTimeout(() => {
      let pattern: FindPattern;
      try {
        pattern = patternOf(query);
      } catch {
        setStatus('bad');
        setTotal(0);
        if (line.current !== undefined) {
          matchAtLine(root, [], line.current).block?.scrollIntoView({ block: 'center', behavior: 'instant' });
          line.current = undefined;
        }
        return;
      }
      const blocks = blocksOf(root);
      runFind(
        blocks.map((entry) => entry.text),
        pattern,
        replaced.signal,
      ).then(
        (matches) => {
          if (stale) {
            return;
          }
          marked = markMatches(blocks, matches);
          groups.current = marked;
          setTotal(marked.length);
          if (marked.length === 0) {
            setStatus('none');
            const at = line.current === undefined ? undefined : matchAtLine(root, marked, line.current);
            at?.block?.scrollIntoView({ block: 'center', behavior: 'instant' });
            line.current = undefined;
            return;
          }
          setStatus('found');
          let first = 0;
          let scroll = true;
          if (line.current !== undefined) {
            const at = matchAtLine(root, marked, line.current);
            if (at.match !== undefined) {
              first = at.match;
            } else if (at.block !== undefined) {
              at.block.scrollIntoView({ block: 'center', behavior: 'instant' });
              scroll = false;
            }
            line.current = undefined;
          }
          show(first, scroll);
        },
        (error: unknown) => {
          if (!stale) {
            setStatus(error instanceof FindTimeout ? 'slow' : 'bad');
            setTotal(0);
          }
        },
      );
    }, typingDelayMs);

    return () => {
      stale = true;
      window.clearTimeout(timer);
      replaced.abort();
      unmark(marked);
      groups.current = [];
    };
  }, [rootRef, html, opened, armed, query, runFind, show]);

  const open = useCallback((text?: string) => {
    setOpened(true);
    setOpenings((count) => count + 1);
    setArmed(true);
    if (text !== undefined && text !== '') {
      setQueryState((prev) => ({ ...prev, text }));
    }
  }, []);

  const setQuery = useCallback((next: FindQuery) => {
    setArmed(true);
    setQueryState(next);
  }, []);

  const close = useCallback((): void => {
    setOpened(false);
    setQueryState(emptyQuery);
    if (findParams.some((name) => searchParams.has(name))) {
      void navigate({ pathname: location.pathname, hash: location.hash }, { replace: true });
    }
  }, [navigate, location.pathname, location.hash, searchParams]);

  return {
    opened,
    openings,
    query,
    status,
    position: total === 0 ? 0 : index + 1,
    total,
    open,
    setQuery,
    run: () => setArmed(true),
    step: (delta: number) => show(index + delta, true),
    close,
  };
}
