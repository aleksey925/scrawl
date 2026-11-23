import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router';

import { usePlatform } from '../platform';

import { blocksOf, markMatches, matchAtLine, reveal, unmark } from './findDom';
import { centerMatch } from './findScreen';
import { FindTimeout, patternOf, type FindPattern, type FindQuery } from './findMatches';
import { noOptions, togglesOf, withOption, type FindOption } from './findOptions';
import { storedOptions, storeOptions } from './storedOptions';

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
  toggle: (name: FindOption) => void;
  run: () => void;
  step: (delta: number) => void;
  close: () => void;
}

const optionsKey = 'scrawl.find.options';

function emptyQuery(): FindQuery {
  return { text: '', ...storedOptions(optionsKey, noOptions) };
}

function queryOf(params: URLSearchParams): FindQuery | undefined {
  const text = params.get(findParam);
  if (text === null || text === '') {
    return undefined;
  }
  return { text, ...togglesOf(params), fuzzy: false };
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
  const activeGroup = useRef<readonly HTMLElement[]>([]);
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
        setQueryState(emptyQuery());
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
    for (const mark of activeGroup.current) {
      mark.dataset.active = 'false';
    }
    const group = found[next] ?? [];
    for (const mark of group) {
      mark.dataset.active = 'true';
    }
    activeGroup.current = group;
    const first = group[0];
    if (first !== undefined && scroll) {
      reveal(first);
      centerMatch(first);
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
          const block = matchAtLine(root, [], line.current).block;
          if (block !== undefined) {
            centerMatch(block);
          }
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
            if (at?.block !== undefined) {
              centerMatch(at.block);
            }
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
              centerMatch(at.block);
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

  const linked = fromUrl !== undefined;
  const toggle = useCallback((name: FindOption): void => {
    const { text, ...options } = withOption(query, name);
    if (linked) {
      const kept = storedOptions(optionsKey, noOptions);
      if (kept[name] !== options[name]) {
        storeOptions(optionsKey, withOption(kept, name));
      }
    } else {
      storeOptions(optionsKey, options);
    }
    setQuery({ text, ...options });
  }, [query, linked, setQuery]);

  const close = useCallback((): void => {
    setOpened(false);
    setQueryState(emptyQuery());
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
    toggle,
    run: () => setArmed(true),
    step: (delta: number) => show(index + delta, true),
    close,
  };
}
