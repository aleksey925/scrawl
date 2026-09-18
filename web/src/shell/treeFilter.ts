import type { NavNode } from '../api/types';
import { displayName } from '../paths';

export interface FilteredTree {
  visible: ReadonlySet<string>;
  forcedOpen: ReadonlySet<string>;
  // every node whose own name matches, in document order
  matches: readonly NavNode[];
}

const everything: FilteredTree = { visible: new Set(), forcedOpen: new Set(), matches: [] };

export function filterTree(nodes: readonly NavNode[], query: string): FilteredTree {
  if (query === '') {
    return everything;
  }
  const visible = new Set<string>();
  const forcedOpen = new Set<string>();
  const matches: NavNode[] = [];

  const walk = (node: NavNode): boolean => {
    const self = displayName(node.name).toLowerCase().includes(query);
    if (self) {
      matches.push(node);
    }
    let childHit = false;
    for (const child of node.children) {
      childHit = walk(child) || childHit;
    }
    const show = self || childHit;
    if (show) {
      visible.add(node.path);
    }
    if (node.is_dir && show) {
      forcedOpen.add(node.path);
    }
    return show;
  };

  for (const node of nodes) {
    walk(node);
  }
  return { visible, forcedOpen, matches };
}
