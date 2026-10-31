import {
  createContext, useContext, useEffect, useMemo, useRef, useState,
  type JSX, type ReactNode,
} from 'react';
import { Router, parsePath, type Location, type Navigator, type To } from 'react-router';

import { holdPosition } from '../reader/position';
import { readJson, sessionStore, writeJson } from '../storage';

import { fileOf } from './files';
import { loadPage, type PageStore } from './pages';

interface Entry {
  usr: unknown;
  key: string;
  route: string;
  title: string;
}

const positionsKey = 'scrawl.site.positions';
const keepScrollMs = 300;
const maxPositions = 200;

function readPositions(): Record<string, number> {
  return readJson<Record<string, number>>(sessionStore(), positionsKey) ?? {};
}

function writePosition(key: string, top: number): void {
  const positions = readPositions();
  delete positions[key];
  positions[key] = top;
  const keys = Object.keys(positions);
  for (const old of keys.slice(0, Math.max(0, keys.length - maxPositions))) {
    delete positions[old];
  }
  writeJson(sessionStore(), positionsKey, positions);
}

function freshKey(): string {
  return Math.random().toString(36).slice(2, 10);
}

function entryNow(): Partial<Entry> {
  return (window.history.state as Partial<Entry> | null) ?? {};
}

function locationAt(route: string): Location {
  const entry = entryNow();
  return {
    pathname: route,
    search: window.location.search,
    hash: window.location.hash,
    state: entry.usr ?? null,
    key: entry.key ?? 'default',
  };
}

function canFetchPages(): boolean {
  return window.location.protocol === 'http:' || window.location.protocol === 'https:';
}

const HistoryPlacedContext = createContext<string | undefined>(undefined);

export function useHistoryPlaced(): string | undefined {
  return useContext(HistoryPlacedContext);
}

export interface SiteRouterProps {
  route: string;
  root: URL;
  store: PageStore;
  children: ReactNode;
}

export function SiteRouter({ route: first, root, store, children }: SiteRouterProps): JSX.Element {
  const [location, setLocation] = useState(() => locationAt(entryNow().route ?? first));
  const [placedKey, setPlacedKey] = useState<string | undefined>(undefined);
  const current = useRef(location);
  current.current = location;

  const scrolls = useRef(new Map<string, number>());
  const pending = useRef<number | undefined>(undefined);
  const inFlight = useRef<AbortController | undefined>(undefined);

  useEffect(() => {
    const entry = entryNow();
    window.history.replaceState(
      { ...entry, key: entry.key ?? freshKey(), route: entry.route ?? first, title: entry.title ?? document.title },
      '',
    );
    if (canFetchPages()) {
      window.history.scrollRestoration = 'manual';
      const kept = entry.key === undefined ? undefined : readPositions()[entry.key];
      if (kept !== undefined) {
        pending.current = kept;
      }
    }
    setLocation(locationAt(entryNow().route ?? first));
  }, [first]);

  const keep = useMemo(() => {
    let timer: number | undefined;
    let waiting: { key: string; top: number } | undefined;
    const flush = (): void => {
      window.clearTimeout(timer);
      if (waiting !== undefined) {
        writePosition(waiting.key, waiting.top);
        waiting = undefined;
      }
    };
    return {
      later: (): void => {
        const { key } = current.current;
        scrolls.current.set(key, window.scrollY);
        if (waiting !== undefined && waiting.key !== key) {
          flush();
        }
        waiting = { key, top: window.scrollY };
        window.clearTimeout(timer);
        timer = window.setTimeout(flush, keepScrollMs);
      },
      now: (): void => {
        flush();
        const { key } = current.current;
        scrolls.current.set(key, window.scrollY);
        writePosition(key, window.scrollY);
      },
    };
  }, []);

  useEffect(() => {
    window.addEventListener('scroll', keep.later, { passive: true });
    window.addEventListener('pagehide', keep.now);
    return () => {
      window.removeEventListener('scroll', keep.later);
      window.removeEventListener('pagehide', keep.now);
    };
  }, [keep]);

  useEffect(() => {
    const top = pending.current;
    pending.current = undefined;
    if (top === undefined) {
      scrolls.current.set(location.key, window.scrollY);
      return undefined;
    }
    scrolls.current.set(location.key, top);
    return holdPosition(() => window.scrollTo({ top, behavior: 'instant' }), window);
  }, [location.key]);

  const cancelPending = (): AbortController => {
    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;
    return controller;
  };

  const navigator = useMemo<Navigator>(() => {
    const pathOf = (to: To): Partial<Location> => (typeof to === 'string' ? parsePath(to) : to);
    const href = (to: To): string => {
      const target = pathOf(to);
      const url = new URL(fileOf(target.pathname ?? current.current.pathname), root);
      return url.href + (target.search ?? '') + (target.hash ?? '');
    };

    const goTo = async (to: To, state: unknown, replace: boolean): Promise<void> => {
      const target = href(to);
      const controller = cancelPending();
      keep.now();
      let shown;
      try {
        shown = await loadPage(target.replace(/#.*$/, ''), controller.signal);
      } catch {
        if (!controller.signal.aborted) {
          window.location.assign(target);
        }
        return;
      }
      if (controller.signal.aborted) {
        return;
      }
      store.add(shown);
      keep.now();
      const entry: Entry = { usr: state ?? null, key: freshKey(), route: shown.page.route, title: shown.title };
      if (replace) {
        window.history.replaceState(entry, '', target);
      } else {
        window.history.pushState(entry, '', target);
      }
      document.title = shown.title;
      pending.current = new URL(target).hash === '' ? 0 : undefined;
      setPlacedKey(undefined);
      setLocation(locationAt(shown.page.route));
    };

    const move = (to: To, state: unknown, replace: boolean): void => {
      const target = pathOf(to);
      if ((target.pathname ?? current.current.pathname) !== current.current.pathname) {
        if (canFetchPages()) {
          void goTo(to, state, replace);
        } else if (replace) {
          window.location.replace(href(to));
        } else {
          window.location.assign(href(to));
        }
        return;
      }
      cancelPending();
      keep.now();
      const url = new URL(window.location.href);
      url.search = target.search ?? '';
      url.hash = target.hash ?? '';
      const entry: Entry = { usr: state ?? null, key: freshKey(), route: current.current.pathname, title: document.title };
      if (replace) {
        window.history.replaceState(entry, '', url.href);
      } else {
        window.history.pushState(entry, '', url.href);
      }
      setLocation(locationAt(current.current.pathname));
    };

    return {
      createHref: href,
      go: (delta) => window.history.go(delta),
      push: (to, state) => move(to, state, false),
      replace: (to, state) => move(to, state, true),
    };
  }, [root, store, keep]);

  useEffect(() => {
    const arrive = (route: string, title: string | undefined): void => {
      const entry = entryNow();
      const kept = entry.key === undefined ? undefined : (scrolls.current.get(entry.key) ?? readPositions()[entry.key]);
      pending.current = kept ?? (window.location.hash === '' ? 0 : undefined);
      if (title !== undefined) {
        document.title = title;
      }
      setPlacedKey(kept === undefined ? undefined : entry.key);
      setLocation(locationAt(route));
    };

    const onPop = (): void => {
      const controller = cancelPending();
      keep.now();
      const entry = entryNow();
      const route = entry.route ?? first;
      if (route === current.current.pathname) {
        arrive(route, undefined);
        return;
      }
      const shown = store.shown(route);
      if (shown !== undefined) {
        arrive(route, entry.title ?? shown.title);
        return;
      }
      loadPage(window.location.href.replace(/#.*$/, ''), controller.signal).then(
        (loaded) => {
          if (!controller.signal.aborted) {
            store.add(loaded);
            arrive(route, loaded.title);
          }
        },
        () => {
          if (!controller.signal.aborted) {
            window.location.reload();
          }
        },
      );
    };
    window.addEventListener('popstate', onPop);
    window.addEventListener('hashchange', onPop);
    return () => {
      window.removeEventListener('popstate', onPop);
      window.removeEventListener('hashchange', onPop);
    };
  }, [first, store, keep]);

  return (
    <Router location={location} navigator={navigator}>
      <HistoryPlacedContext.Provider value={placedKey}>{children}</HistoryPlacedContext.Provider>
    </Router>
  );
}
