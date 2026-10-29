import type { DirListing, NavNode, PageResponse } from '../api/types';
import type { Mermaid, PlantUML } from '../reader/diagrams';
import type { Katex } from '../reader/typeset';

export interface SitePage {
  route: string;
  root: string;
  answer: PageResponse | DirListing;
}

export interface SiteData {
  title: string;
  tree: NavNode[];
}

declare global {
  interface Window {
    scrawlSite?: SiteData;
    scrawlMermaid?: Mermaid;
    scrawlPlantUML?: PlantUML;
    scrawlKatex?: Katex;
  }
}

export function readPage(doc: Document = document): SitePage {
  const node = doc.querySelector('script[type="application/json"][data-scrawl="page"]');
  if (node === null) {
    throw new Error('the page carries no answer, it was not written by scrawl site');
  }
  const page = JSON.parse(node.textContent ?? '') as Partial<SitePage>;
  if (typeof page.route !== 'string' || typeof page.root !== 'string' || page.answer === undefined) {
    throw new Error('the answer the page carries is not one scrawl site writes');
  }
  return page as SitePage;
}
