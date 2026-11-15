import { createContext, useContext, useEffect, useState, type JSX, type ReactNode } from 'react';
import { useLocation } from 'react-router';

import type { Crumb } from '../api/types';
import { directoryUrl } from '../paths';

import { ancestorsOf, basenameOf, contentPathOf } from './naming';

export interface DraftChrome {
  path: string;
  rename: (name: string) => boolean;
}

export interface PageChrome {
  crumbs: readonly Crumb[];
  name: string;
  title: string;
  ownTitle: boolean;
  draft?: DraftChrome;
}

const PageChromeContext = createContext<PageChrome | undefined>(undefined);

const SetPageChromeContext = createContext<((chrome: PageChrome) => void) | undefined>(undefined);

export function PageChromeProvider({ children }: { children: ReactNode }): JSX.Element {
  const [chrome, setChrome] = useState<PageChrome | undefined>(undefined);
  return (
    <SetPageChromeContext.Provider value={setChrome}>
      <PageChromeContext.Provider value={chrome}>{children}</PageChromeContext.Provider>
    </SetPageChromeContext.Provider>
  );
}

export function chromeOf(breadcrumbs: readonly Crumb[], title: string, ownTitle: boolean, name = title): PageChrome {
  return { crumbs: breadcrumbs.slice(1, -1), name, title, ownTitle };
}

export function standaloneChrome(title: string): PageChrome {
  return { crumbs: [], name: title, title, ownTitle: true };
}

export function usePageChrome({ crumbs, name, title, ownTitle }: PageChrome): void {
  const setChrome = useContext(SetPageChromeContext);
  const crumbsKey = crumbs.map((step) => `${step.url}\n${step.name}`).join('\n');
  useEffect(() => {
    setChrome?.({ crumbs, name, title, ownTitle });
  }, [crumbsKey, name, title, ownTitle, setChrome]);
}

function chromeOfPath(path: string): PageChrome {
  const ancestors = ancestorsOf(path);
  const crumbs = ancestors.slice(1, -1).map((folder) => ({ name: basenameOf(folder), url: directoryUrl(folder) }));
  const last = basenameOf(ancestors[ancestors.length - 1] ?? '');
  return { crumbs, name: last, title: last, ownTitle: false };
}

function chromeFromRoute(pathname: string): PageChrome {
  return chromeOfPath(contentPathOf(pathname));
}

export function useDraftChrome(draft: DraftChrome | undefined): void {
  const setChrome = useContext(SetPageChromeContext);
  const path = draft?.path;
  const rename = draft?.rename;
  useEffect(() => {
    if (path !== undefined && rename !== undefined) {
      setChrome?.({ ...chromeOfPath(path), draft: { path, rename } });
    }
  }, [path, rename, setChrome]);
}

export function RouteChrome(): null {
  const location = useLocation();
  usePageChrome(chromeFromRoute(location.pathname));
  return null;
}

export function useShownChrome(): PageChrome {
  const location = useLocation();
  return useContext(PageChromeContext) ?? chromeFromRoute(location.pathname);
}
