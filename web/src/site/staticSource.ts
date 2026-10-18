import type { NavNode } from '../api/types';
import { ApiError } from '../api/errors';
import type { Platform } from '../platform';

import type { SiteData, SitePage } from './data';
import { isFolderRoute } from './files';

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

// every route but the page's own is a page load of its own, so nothing else is
// ever asked; anything that still is gets the 404 a missing answer would be
function missing(): Promise<never> {
  return Promise.reject(new ApiError(404, { error: 'that is not on this page' }));
}

// staticSource answers from what the page and the site carry
export function staticSource(page: SitePage, site: SiteData): Platform['source'] {
  const { answer } = page;
  const isDir = isFolderRoute(page.route);
  return {
    page: (path) => (!isDir && answer.kind !== 'directory' && answer.path === path ? Promise.resolve(answer) : missing()),
    dir: (path) =>
      isDir && answer.kind !== 'missing-document' && answer.path === path ? Promise.resolve(answer) : missing(),
    nav: (path) => Promise.resolve({ tree: markBranch(site.tree, path), breadcrumbs: answer.breadcrumbs }),
  };
}
