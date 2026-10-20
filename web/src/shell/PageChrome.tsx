import { createContext, useContext, useEffect, useMemo, useState, type JSX, type ReactNode } from 'react';
import { useLocation } from 'react-router';

import type { Crumb } from '../api/types';
import { directoryUrl } from '../paths';

import { contentPathOf } from './naming';

// PageChrome is what the page on screen tells the topbar about itself: the
// folders on the way to it and its title. Only the page's answer knows a
// note's title, so the topbar reads it here and never off the URL alone.
export interface PageChrome {
  // the folders between the space and the page, the space itself left out
  crumbs: readonly Crumb[];
  title: string;
  // ownTitle is whether the page draws its title itself, as a note with a
  // leading heading does
  ownTitle: boolean;
}

interface PageChromeState {
  chrome: PageChrome | undefined;
  setChrome: (chrome: PageChrome) => void;
}

const PageChromeContext = createContext<PageChromeState | undefined>(undefined);

// PageChromeProvider keeps the last page's chrome until the next page hands in
// its own, the way every screen keeps its answer while it fetches the next one
export function PageChromeProvider({ children }: { children: ReactNode }): JSX.Element {
  const [chrome, setChrome] = useState<PageChrome | undefined>(undefined);
  const value = useMemo(() => ({ chrome, setChrome }), [chrome]);
  return <PageChromeContext.Provider value={value}>{children}</PageChromeContext.Provider>;
}

export function usePageChromeValue(): PageChrome | undefined {
  return useContext(PageChromeContext)?.chrome;
}

// chromeOf turns the breadcrumbs of an answer into the page's chrome: the
// server's first crumb is the space and its last the page itself
export function chromeOf(breadcrumbs: readonly Crumb[], title: string, ownTitle = false): PageChrome {
  return { crumbs: breadcrumbs.slice(1, -1), title, ownTitle };
}

// usePageChrome hands the page's chrome to the topbar while the page is shown
export function usePageChrome(chrome: PageChrome): void {
  const setChrome = useContext(PageChromeContext)?.setChrome;
  const key = JSON.stringify(chrome);
  useEffect(() => {
    setChrome?.(JSON.parse(key) as PageChrome);
  }, [key, setChrome]);
}

// chromeFromRoute is what the bar can say before the first answer has arrived:
// the folders of the route by their names, and the last segment as the title
function chromeFromRoute(pathname: string): PageChrome {
  const segments = contentPathOf(pathname).split('/').filter((segment) => segment !== '');
  const crumbs: Crumb[] = [];
  let prefix = '';
  for (const segment of segments.slice(0, -1)) {
    prefix = prefix === '' ? segment : `${prefix}/${segment}`;
    crumbs.push({ name: segment, url: directoryUrl(prefix) });
  }
  return { crumbs, title: segments[segments.length - 1] ?? '', ownTitle: false };
}

// useShownChrome is the chrome of the page on screen, or the route's until the
// page has answered
export function useShownChrome(): PageChrome {
  const location = useLocation();
  return usePageChromeValue() ?? chromeFromRoute(location.pathname);
}
