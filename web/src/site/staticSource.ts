import { ApiError } from '../api/errors';
import { answerKeys } from '../api/useApi';
import type { Platform } from '../platform';
import { markBranch } from '../reader/tree';

import type { SiteData } from './data';
import type { PageStore } from './pages';

function missing(): Promise<never> {
  return Promise.reject(new ApiError(404, { error: 'that page has not been read' }));
}

export function staticSource(store: PageStore, site: SiteData): Platform['source'] {
  return {
    page: (path) => {
      const answer = store.answer(answerKeys.page(path));
      return answer !== undefined && answer.kind !== 'directory' ? Promise.resolve(answer) : missing();
    },
    dir: (path) => {
      const answer = store.answer(answerKeys.dir(path));
      return answer !== undefined && answer.kind === 'directory' ? Promise.resolve(answer) : missing();
    },
    nav: (path) => Promise.resolve({ tree: markBranch(site.tree, path), breadcrumbs: [] }),
  };
}
