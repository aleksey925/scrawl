import { createContext, useContext } from 'react';

import type { ScrawlApi } from './api/client';
import type { Mermaid } from './reader/diagrams';
import type { FindMatch, FindPattern } from './reader/findMatches';
import type { InternalTarget } from './reader/links';
import type { Katex } from './reader/typeset';

// Platform is what the reader asks of the place it runs in: the app served by
// the go server, or a site written to disk, where nothing answers a request.
// Everything else the reader does is the same code in both.
export interface Platform {
  // the answers the reader shows, in the shapes the server's routes send
  source: Pick<ScrawlApi, 'page' | 'dir' | 'nav'>;
  // physicalUrl turns a router-relative url of a note or a file into the one
  // the browser loads itself
  physicalUrl: (url: string) => string;
  // internalTarget names the route a link of a note belongs to, or nothing
  // when the browser should follow the link itself
  internalTarget: (link: HTMLAnchorElement) => InternalTarget | undefined;
  loadMermaid: () => Promise<Mermaid>;
  loadKatex: () => Promise<Katex>;
  // storageScope keeps what the reader remembers apart per space or per site
  storageScope: string;
  // search is whether the text of the notes can be searched
  search: boolean;
  // editing is whether a note can be written here at all
  editing: boolean;
  // runFind runs the find of a note over the joined text of its blocks, and
  // gives up when the signal says the find is no longer wanted
  runFind: (texts: string[], pattern: FindPattern, signal: AbortSignal) => Promise<FindMatch[]>;
  // boundedFind is whether runFind stops a pattern that runs too long, which
  // a worker can and a page opened from disk, which starts none, cannot
  boundedFind: boolean;
}

const PlatformContext = createContext<Platform | undefined>(undefined);

export const PlatformProvider = PlatformContext.Provider;

export function usePlatform(): Platform {
  const platform = useContext(PlatformContext);
  if (platform === undefined) {
    throw new Error('the platform is only available inside the reader');
  }
  return platform;
}
