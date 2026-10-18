import { useEffect, useMemo, useState, type JSX, type ReactNode } from 'react';
import { Router, parsePath, type Location, type Navigator, type To } from 'react-router';

import { fileOf } from './files';

// what a page of a site keeps in the history entries it adds itself
interface Entry {
  usr: unknown;
  key: string;
}

function freshKey(): string {
  return Math.random().toString(36).slice(2, 10);
}

// a page stands for one route, and the address bar holds the file instead, so
// the route comes from the page and only the query and the hash from the bar
function locationAt(route: string): Location {
  const entry = window.history.state as Partial<Entry> | null;
  return {
    pathname: route,
    search: window.location.search,
    hash: window.location.hash,
    state: entry?.usr ?? null,
    key: entry?.key ?? 'default',
  };
}

export interface SiteRouterProps {
  // the route of the app this page was written for
  route: string;
  // the way from this page back to the root of the site
  root: string;
  children: ReactNode;
}

// SiteRouter runs the app's routes over the files of a site. A link to another
// route is a link to another file and the browser loads it; a move within the
// page, a fragment or a query, stays on it, which a page opened from disk may
// do too, since only the file has to stay the same.
export function SiteRouter({ route, root, children }: SiteRouterProps): JSX.Element {
  const [location, setLocation] = useState(() => locationAt(route));

  useEffect(() => {
    const sync = (): void => setLocation(locationAt(route));
    window.addEventListener('popstate', sync);
    window.addEventListener('hashchange', sync);
    return () => {
      window.removeEventListener('popstate', sync);
      window.removeEventListener('hashchange', sync);
    };
  }, [route]);

  const navigator = useMemo<Navigator>(() => {
    const pathOf = (to: To): Partial<Location> => (typeof to === 'string' ? parsePath(to) : to);
    const href = (to: To): string => {
      const target = pathOf(to);
      return `${root}${fileOf(target.pathname ?? route)}${target.search ?? ''}${target.hash ?? ''}`;
    };
    const move = (to: To, state: unknown, replace: boolean): void => {
      const target = pathOf(to);
      if ((target.pathname ?? route) !== route) {
        if (replace) {
          window.location.replace(href(to));
        } else {
          window.location.assign(href(to));
        }
        return;
      }
      const url = new URL(window.location.href);
      url.search = target.search ?? '';
      url.hash = target.hash ?? '';
      const entry: Entry = { usr: state ?? null, key: freshKey() };
      if (replace) {
        window.history.replaceState(entry, '', url.href);
      } else {
        window.history.pushState(entry, '', url.href);
      }
      setLocation(locationAt(route));
    };
    return {
      createHref: href,
      go: (delta) => window.history.go(delta),
      push: (to, state) => move(to, state, false),
      replace: (to, state) => move(to, state, true),
    };
  }, [route, root]);

  return (
    <Router location={location} navigator={navigator}>
      {children}
    </Router>
  );
}
