import {
  createContext, useContext, useEffect, useMemo, useRef, useState,
  type JSX, type ReactNode,
} from 'react';
import { Router, parsePath, type Location, type Navigator, type To } from 'react-router';

import { holdPosition } from '../reader/position';

import { fileOf } from './files';
import { loadPage, type PageStore } from './pages';

// what a page of a site keeps in the history entries it adds itself: the
// route the entry shows, which the address bar does not say, its title, and
// where it was scrolled to, which survives a reload of the page
interface Entry {
  usr: unknown;
  key: string;
  route: string;
  title: string;
  scroll?: number;
}

// a reader scrolls in bursts, and a browser limits how often an entry may be
// rewritten, so the position is written once the burst is over
const keepScrollMs = 300;

function freshKey(): string {
  return Math.random().toString(36).slice(2, 10);
}

function entryNow(): Partial<Entry> {
  return (window.history.state as Partial<Entry> | null) ?? {};
}

// the address bar holds the file and not the route, so the route comes from
// the entry and only the query and the hash from the bar
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

// a page from a host can fetch the next one; a page opened from disk can
// fetch nothing, so every move to another file there is a page load
function canFetchPages(): boolean {
  return window.location.protocol === 'http:' || window.location.protocol === 'https:';
}

// the key of the arrival history puts back where it was, which nothing else
// may move while it is being put there
const HistoryPlacedContext = createContext<string | undefined>(undefined);

export function useHistoryPlaced(): string | undefined {
  return useContext(HistoryPlacedContext);
}

export interface SiteRouterProps {
  // the route of the app the page was loaded for
  route: string;
  // the root of the site, which every file of it is relative to
  root: URL;
  store: PageStore;
  children: ReactNode;
}

// SiteRouter runs the app's routes over the files of a site. From a host, a
// move to another route reads that route's page and shows its answer the way
// the app shows one from the server, with no page load. From disk, it is a
// page load, and only a move within the page stays on it.
export function SiteRouter({ route: first, root, store, children }: SiteRouterProps): JSX.Element {
  const [location, setLocation] = useState(() => locationAt(entryNow().route ?? first));
  const [placedKey, setPlacedKey] = useState<string | undefined>(undefined);
  const current = useRef(location);
  current.current = location;

  // where each entry of this tab was left, by its key, and where the entry
  // being shown has to be put once it is on screen
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
      // the browser cannot put a page back where it was when it never loaded
      // it, so every position is kept and put back here
      window.history.scrollRestoration = 'manual';
      if (entry.scroll !== undefined) {
        pending.current = entry.scroll;
      }
    }
    setLocation(locationAt(entryNow().route ?? first));
  }, [first]);

  // the position of the entry on screen goes into the entry itself, so a
  // reload and a Back after it still know where every entry was left
  const keep = useMemo(() => {
    let timer: number | undefined;
    const write = (key: string, top: number): void => {
      const entry = entryNow();
      if (entry.key === key) {
        window.history.replaceState({ ...entry, scroll: top }, '');
      }
    };
    return {
      later: (): void => {
        const { key } = current.current;
        scrolls.current.set(key, window.scrollY);
        window.clearTimeout(timer);
        timer = window.setTimeout(() => write(key, window.scrollY), keepScrollMs);
      },
      now: (): void => {
        const { key } = current.current;
        window.clearTimeout(timer);
        scrolls.current.set(key, window.scrollY);
        write(key, window.scrollY);
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

  // a page is put where it belongs once it is drawn, and held there while its
  // pictures and diagrams move it, until the reader moves it themselves; an
  // entry nobody scrolled is still where it starts, which is a place too
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

  // a move the reader asked for after this one wins: the page still on its
  // way must not be shown over it
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
      const entry: Entry = { usr: state ?? null, key: freshKey(), route: shown.page.route, title: shown.title };
      if (replace) {
        window.history.replaceState(entry, '', target);
      } else {
        window.history.pushState(entry, '', target);
      }
      document.title = shown.title;
      // a new note starts at its top, unless a hash names the heading it
      // lands on by itself
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
      const kept = entry.key === undefined ? undefined : (scrolls.current.get(entry.key) ?? entry.scroll);
      // history knows where the entry was left, and that beats the heading a
      // hash names; an entry it knows nothing of starts at the top
      pending.current = kept ?? (window.location.hash === '' ? 0 : undefined);
      if (title !== undefined) {
        document.title = title;
      }
      setPlacedKey(kept === undefined ? undefined : entry.key);
      setLocation(locationAt(route));
    };

    const onPop = (): void => {
      const controller = cancelPending();
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
      // the page was let go of to keep the memory bounded, so it is read again
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
  }, [first, store]);

  return (
    <Router location={location} navigator={navigator}>
      <HistoryPlacedContext.Provider value={placedKey}>{children}</HistoryPlacedContext.Provider>
    </Router>
  );
}
