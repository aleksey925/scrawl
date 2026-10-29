import { createContext, useContext } from 'react';

import type { ScrawlApi } from './api/client';
import type { Mermaid, PlantUML } from './reader/diagrams';
import type { FindMatch, FindPattern } from './reader/findMatches';
import type { InternalTarget } from './reader/links';
import type { Katex } from './reader/typeset';

export interface Platform {
  source: Pick<ScrawlApi, 'page' | 'dir' | 'nav'>;
  physicalUrl: (url: string) => string;
  internalTarget: (link: HTMLAnchorElement) => InternalTarget | undefined;
  loadMermaid: () => Promise<Mermaid>;
  loadPlantUML: () => Promise<PlantUML>;
  loadKatex: () => Promise<Katex>;
  storageScope: string;
  search: boolean;
  editing: boolean;
  runFind: (texts: string[], pattern: FindPattern, signal: AbortSignal) => Promise<FindMatch[]>;
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
