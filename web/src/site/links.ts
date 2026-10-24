import type { NavNode } from '../api/types';
import type { InternalTarget } from '../reader/links';

import { fileOf } from './files';

const folderPage = 'index.html';

function decoded(path: string): string | undefined {
  try {
    return decodeURIComponent(path);
  } catch {
    return undefined;
  }
}

function filesOf(nodes: readonly NavNode[], into: Map<string, string>): Map<string, string> {
  for (const node of nodes) {
    const file = decoded(fileOf(node.url));
    if (file !== undefined) {
      into.set(file, node.url);
    }
    filesOf(node.children, into);
  }
  return into;
}

export function siteLinks(root: URL, tree: readonly NavNode[]): (link: HTMLAnchorElement) => InternalTarget | undefined {
  const routes = filesOf(tree, new Map());
  return (link) => {
    const href = link.getAttribute('href');
    if (href === null || href === '' || href.startsWith('#') || (link.target !== '' && link.target !== '_self')) {
      return undefined;
    }
    const url = new URL(href, window.location.href);
    if (url.protocol !== root.protocol || url.host !== root.host || !url.pathname.startsWith(root.pathname)) {
      return undefined;
    }
    const rest = url.pathname.slice(root.pathname.length);
    const file = decoded(rest);
    if (file === undefined) {
      return undefined;
    }
    let route = routes.get(file);
    if (route === undefined && (file === folderPage || file.endsWith(`/${folderPage}`))) {
      const folder = rest.slice(0, rest.length - folderPage.length);
      route = folder === '' ? '/' : `/doc/${folder}`;
    }
    return route === undefined ? undefined : { to: route + url.search + url.hash };
  };
}
