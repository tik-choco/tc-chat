// Turns the flat, per-room list of BoardNodes (each carrying an optional
// parentId) into a forest for rendering. The board's recursion lives entirely
// in the data — parentId links — so this is the one place that reconstructs
// the tree; every renderer just walks it.
import type { BoardNode } from "./chatStore";

export interface NodeTree {
  node: BoardNode;
  children: NodeTree[];
  /** Total replies at any depth beneath this node (for "N件の返信" hints). */
  replyCount: number;
}

/**
 * Builds the roots-with-nested-children forest. Children are ordered oldest
 * first (thread reading order); roots are returned newest first so fresh
 * threads surface at the top. Orphan nodes (a parent that never arrived) are
 * treated as roots so nothing is silently dropped.
 */
export function buildForest(nodes: BoardNode[]): NodeTree[] {
  const byId = new Map<string, NodeTree>();
  for (const node of nodes) {
    byId.set(node.id, { node, children: [], replyCount: 0 });
  }

  const roots: NodeTree[] = [];
  for (const node of nodes) {
    const entry = byId.get(node.id)!;
    const parent = node.parentId ? byId.get(node.parentId) : undefined;
    if (parent) parent.children.push(entry);
    else roots.push(entry);
  }

  const finalize = (entry: NodeTree): number => {
    entry.children.sort((a, b) => a.node.timestamp - b.node.timestamp);
    let count = entry.children.length;
    for (const child of entry.children) count += finalize(child);
    entry.replyCount = count;
    return count;
  };
  for (const root of roots) finalize(root);

  roots.sort((a, b) => b.node.timestamp - a.node.timestamp);
  return roots;
}
