import type { NavNode } from '../api/types';
import { ApiError } from '../api/errors';
import { answerKeys } from '../api/useApi';
import type { Platform } from '../platform';

import type { SiteData } from './data';
import type { PageStore } from './pages';

// markBranch marks the way to current through the tree, the way the server
// marks the tree it answers with
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

// a route is shown once its page has been read, so nothing else is ever
// asked; anything that still is gets the 404 a missing answer would be
function missing(): Promise<never> {
  return Promise.reject(new ApiError(404, { error: 'that page has not been read' }));
}

// staticSource answers from the pages the site has shown and the tree it shares
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
