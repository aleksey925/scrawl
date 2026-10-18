import type { DirResponse, NavNode, PageResponse } from '../api/types';
import type { Mermaid } from '../reader/diagrams';
import type { Katex } from '../reader/typeset';

// SitePage is what `scrawl site` writes into every page: the route of the app
// the page stands for, the way from the page back to the root of the site, and
// the answer the server would have given for that route
export interface SitePage {
  route: string;
  root: string;
  answer: PageResponse | DirResponse;
}

// SiteData is what scrawl/tree.js holds, the one copy every page shares
export interface SiteData {
  title: string;
  tree: NavNode[];
}

declare global {
  interface Window {
    scrawlSite?: SiteData;
    scrawlMermaid?: Mermaid;
    scrawlKatex?: Katex;
  }
}

// readPage takes the answer the page carries, found by an attribute and never
// by an id, which a heading of the note could take
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
