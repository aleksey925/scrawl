import { createContext, useContext, useEffect, useMemo, useState, type JSX, type ReactNode } from 'react';
import { useLocation } from 'react-router';

import type { Crumb } from '../api/types';
import { directoryUrl, isDirectoryPath } from '../paths';

import { ancestorsOf, basenameOf, contentPathOf, pageName } from './naming';

export interface PageChrome {
  crumbs: readonly Crumb[];
  title: string;
  ownTitle: boolean;
}

interface PageChromeState {
  chrome: PageChrome | undefined;
  setChrome: (chrome: PageChrome) => void;
}

const PageChromeContext = createContext<PageChromeState | undefined>(undefined);

export function PageChromeProvider({ children }: { children: ReactNode }): JSX.Element {
  const [chrome, setChrome] = useState<PageChrome | undefined>(undefined);
  const value = useMemo(() => ({ chrome, setChrome }), [chrome]);
  return <PageChromeContext.Provider value={value}>{children}</PageChromeContext.Provider>;
}

function usePageChromeValue(): PageChrome | undefined {
  return useContext(PageChromeContext)?.chrome;
}

export function chromeOf(breadcrumbs: readonly Crumb[], title: string, ownTitle: boolean): PageChrome {
  return { crumbs: breadcrumbs.slice(1, -1), title, ownTitle };
}

export function usePageChrome({ crumbs, title, ownTitle }: PageChrome): void {
  const setChrome = useContext(PageChromeContext)?.setChrome;
  const crumbsKey = crumbs.map((step) => `${step.url}\n${step.name}`).join('\n');
  useEffect(() => {
    setChrome?.({ crumbs, title, ownTitle });
  }, [crumbsKey, title, ownTitle, setChrome]);
}

function chromeFromRoute(pathname: string): PageChrome {
  const ancestors = ancestorsOf(contentPathOf(pathname));
  const crumbs = ancestors.slice(1, -1).map((folder) => ({ name: basenameOf(folder), url: directoryUrl(folder) }));
  const last = basenameOf(ancestors[ancestors.length - 1] ?? '');
  return { crumbs, title: pageName(last, isDirectoryPath(pathname)), ownTitle: false };
}

export function RouteChrome(): null {
  const location = useLocation();
  usePageChrome(chromeFromRoute(location.pathname));
  return null;
}

export function useShownChrome(): PageChrome {
  const location = useLocation();
  return usePageChromeValue() ?? chromeFromRoute(location.pathname);
}
