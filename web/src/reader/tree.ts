import type { NavNode } from '../api/types';

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
