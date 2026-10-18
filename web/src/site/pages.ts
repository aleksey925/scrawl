import { answerKeys, seedResponse } from '../api/useApi';

import { readPage, type SitePage } from './data';
import { isFolderRoute } from './files';

// a page of the site the reader has shown, with the title its tab takes
export interface ShownPage {
  page: SitePage;
  title: string;
}

// enough to go back through a long reading without loading a page again,
// and bounded, since every answer holds its note
const maxPages = 60;

export function answerKeyOf(page: SitePage): string {
  return isFolderRoute(page.route) ? answerKeys.dir(page.answer.path) : answerKeys.page(page.answer.path);
}

// PageStore holds the answers of the pages shown in this tab, by their key
export class PageStore {
  private readonly byKey = new Map<string, ShownPage>();
  private readonly byRoute = new Map<string, ShownPage>();

  add(shown: ShownPage): void {
    const key = answerKeyOf(shown.page);
    this.byKey.delete(key);
    this.byKey.set(key, shown);
    this.byRoute.delete(shown.page.route);
    this.byRoute.set(shown.page.route, shown);
    seedResponse(key, shown.page.answer);
    if (this.byKey.size > maxPages) {
      const [oldest] = this.byKey.values();
      if (oldest !== undefined) {
        this.byKey.delete(answerKeyOf(oldest.page));
        this.byRoute.delete(oldest.page.route);
      }
    }
  }

  answer(key: string): SitePage['answer'] | undefined {
    return this.byKey.get(key)?.page.answer;
  }

  shown(route: string): ShownPage | undefined {
    return this.byRoute.get(route);
  }
}

// loadPage takes the answer another page of the site carries, which is the
// page itself: the site has no other copy of it
export async function loadPage(href: string, signal: AbortSignal): Promise<ShownPage> {
  const response = await fetch(href, { signal });
  if (!response.ok) {
    throw new Error(`${href} answered ${response.status}`);
  }
  const doc = new DOMParser().parseFromString(await response.text(), 'text/html');
  return { page: readPage(doc), title: doc.title };
}
