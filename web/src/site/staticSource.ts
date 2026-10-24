import type { NavNode } from '../api/types';
import { ApiError } from '../api/errors';
import { answerKeys } from '../api/useApi';
import type { Platform } from '../platform';

import type { SiteData } from './data';
import type { PageStore } from './pages';

export function markBranch(nodes: readonly NavNode[], current: string): NavNode[] {
  return nodes.map((node) => {
    const here = node.path === current;
    return {
      ...node,
      current: here,
      active: node.is_dir && (here || current.startsWith(`${node.path}/`)),
      children: markBranch(node.children, current),
    };
  });
}

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
