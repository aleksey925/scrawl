import { useEffect, useMemo, useRef, useState, type JSX, type ReactNode } from 'react';
import { Router, parsePath, type Location, type Navigator, type To } from 'react-router';

import { holdPosition } from '../reader/position';

import { fileOf } from './files';
import { loadPage, type PageStore } from './pages';

// what a page of a site keeps in the history entries it adds itself: the
// route the entry shows, which the address bar does not say, and its title
interface Entry {
  usr: unknown;
  key: string;
  route: string;
  title: string;
  // where the entry was scrolled to, for a Back after a reload
  scroll?: number;
}

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

  useEffect(() => {
    const keep = (): void => {
      scrolls.current.set(current.current.key, window.scrollY);
    };
    // a reload brings the entry back with nothing of this tab's memory
    const leave = (): void => {
      window.history.replaceState({ ...entryNow(), scroll: window.scrollY }, '');
    };
    window.addEventListener('scroll', keep, { passive: true });
    window.addEventListener('pagehide', leave);
    return () => {
      window.removeEventListener('scroll', keep);
      window.removeEventListener('pagehide', leave);
    };
  }, []);

  // a page is put where it belongs once it is drawn, and held there while its
  // pictures and diagrams move it, until the reader moves it themselves
  useEffect(() => {
    const top = pending.current;
    pending.current = undefined;
    if (top === undefined) {
      return undefined;
    }
    return holdPosition(() => window.scrollTo({ top, behavior: 'instant' }), window);
  }, [location.key]);

  const navigator = useMemo<Navigator>(() => {
    const pathOf = (to: To): Partial<Location> => (typeof to === 'string' ? parsePath(to) : to);
    const href = (to: To): string => {
      const target = pathOf(to);
      const url = new URL(fileOf(target.pathname ?? current.current.pathname), root);
      return url.href + (target.search ?? '') + (target.hash ?? '');
    };

    const show = (route: string, title: string, top: number | undefined): void => {
      document.title = title;
      pending.current = top;
      setLocation(locationAt(route));
    };

    const goTo = async (to: To, state: unknown, replace: boolean): Promise<void> => {
      const target = href(to);
      inFlight.current?.abort();
      const controller = new AbortController();
      inFlight.current = controller;
      let shown;
      try {
        shown = await loadPage(new URL(target).href.replace(/#.*$/, ''), controller.signal);
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
      // a hash is the heading the note lands on by itself
      show(shown.page.route, shown.title, new URL(target).hash === '' ? 0 : undefined);
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
  }, [root, store]);

  useEffect(() => {
    const onPop = (): void => {
      const entry = entryNow();
      const route = entry.route ?? first;
      const top = entry.key === undefined ? undefined : scrolls.current.get(entry.key) ?? entry.scroll;
      if (route === current.current.pathname || store.shown(route) !== undefined) {
        if (route !== current.current.pathname) {
          document.title = entry.title ?? store.shown(route)?.title ?? document.title;
        }
        pending.current = top;
        setLocation(locationAt(route));
        return;
      }
      // the page was let go of to keep the memory bounded, so it is read again
      inFlight.current?.abort();
      const controller = new AbortController();
      inFlight.current = controller;
      loadPage(window.location.href.replace(/#.*$/, ''), controller.signal).then(
        (shown) => {
          if (controller.signal.aborted) {
            return;
          }
          store.add(shown);
          document.title = shown.title;
          pending.current = top;
          setLocation(locationAt(route));
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
      {children}
    </Router>
  );
}
