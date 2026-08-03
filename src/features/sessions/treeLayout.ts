import type { SessionTree, SessionTreeEntry } from '@shared/ipc'

/**
 * Session tree → display graph. User messages are primary nodes; runs of
 * assistant/tool entries between them collapse into edge counts. Branch
 * points, branch summaries, compactions and the current leaf always show.
 */

export type DisplayNodeKind = 'root' | 'user' | 'marker' | 'summary' | 'compaction'

export interface DisplayNode {
  id: string
  kind: DisplayNodeKind
  depth: number
  /** Slot index (column) assigned by layout. */
  x: number
  preview?: string
  label?: string
  toolSummary?: string
  onActivePath: boolean
  isLeaf: boolean
  /** Entries collapsed between this node and its display parent. */
  collapsedAbove: number
  timestamp: string
}

export interface DisplayEdge {
  fromId: string
  toId: string
  onActivePath: boolean
  collapsedCount: number
}

export interface TreeLayout {
  nodes: DisplayNode[]
  edges: DisplayEdge[]
  maxDepth: number
  maxX: number
}

export function buildTreeLayout(tree: SessionTree): TreeLayout {
  const byId = new Map<string, SessionTreeEntry>()
  const children = new Map<string, SessionTreeEntry[]>()
  const roots: SessionTreeEntry[] = []
  const labels = new Map<string, string | undefined>()

  for (const entry of tree.entries) {
    if (entry.type === 'label' && entry.targetId) {
      labels.set(entry.targetId, entry.label)
    }
    byId.set(entry.id, entry)
  }
  for (const entry of tree.entries) {
    // Labels and session_info are metadata, not tree branches worth showing.
    if (entry.type === 'label' || entry.type === 'session_info') continue
    if (entry.parentId && byId.has(entry.parentId)) {
      const list = children.get(entry.parentId) ?? []
      list.push(entry)
      children.set(entry.parentId, list)
    } else {
      roots.push(entry)
    }
  }

  // Active path: leaf → root. The leaf may be a metadata entry; walk from the
  // last non-metadata entry instead.
  const activePath = new Set<string>()
  let leafId = tree.leafId
  while (leafId) {
    const entry = byId.get(leafId)
    if (!entry) break
    if (entry.type === 'label' || entry.type === 'session_info') {
      leafId = entry.parentId
      continue
    }
    break
  }
  const effectiveLeaf = leafId
  let cursor = effectiveLeaf
  while (cursor) {
    activePath.add(cursor)
    cursor = byId.get(cursor)?.parentId ?? null
  }

  const isDisplay = (entry: SessionTreeEntry): boolean => {
    if (entry.type === 'branch_summary' || entry.type === 'compaction') return true
    if (entry.type === 'message' && entry.role === 'user') return true
    if ((children.get(entry.id)?.length ?? 0) > 1) return true
    if (entry.id === effectiveLeaf) return true
    if (labels.has(entry.id)) return true
    return false
  }

  const nodes: DisplayNode[] = []
  const edges: DisplayEdge[] = []
  let nextSlot = 0
  let maxDepth = 0

  interface WalkState {
    entry: SessionTreeEntry
    displayParentId: string
    collapsed: number
    depth: number
  }

  const nodeById = new Map<string, DisplayNode>()

  const rootNode: DisplayNode = {
    id: '__root__',
    kind: 'root',
    depth: 0,
    x: 0,
    onActivePath: true,
    isLeaf: false,
    collapsedAbove: 0,
    timestamp: '',
  }
  nodes.push(rootNode)
  nodeById.set(rootNode.id, rootNode)

  // Depth-first walk collapsing non-display chains.
  const walk = (state: WalkState): void => {
    const { entry } = state
    if (isDisplay(entry)) {
      const node: DisplayNode = {
        id: entry.id,
        kind:
          entry.type === 'branch_summary'
            ? 'summary'
            : entry.type === 'compaction'
              ? 'compaction'
              : entry.type === 'message' && entry.role === 'user'
                ? 'user'
                : 'marker',
        depth: state.depth,
        x: 0,
        preview: entry.preview ?? entry.summary,
        label: labels.get(entry.id) ?? undefined,
        toolSummary: entry.toolName,
        onActivePath: activePath.has(entry.id),
        isLeaf: entry.id === effectiveLeaf,
        collapsedAbove: state.collapsed,
        timestamp: entry.timestamp,
      }
      nodes.push(node)
      nodeById.set(node.id, node)
      edges.push({
        fromId: state.displayParentId,
        toId: entry.id,
        onActivePath: activePath.has(entry.id) && nodeById.get(state.displayParentId)!.onActivePath,
        collapsedCount: state.collapsed,
      })
      maxDepth = Math.max(maxDepth, state.depth)

      const kids = children.get(entry.id) ?? []
      if (kids.length === 0) {
        node.x = nextSlot++
        return
      }
      for (const kid of kids) {
        walk({ entry: kid, displayParentId: entry.id, collapsed: 0, depth: state.depth + 1 })
      }
      // Center over display children (fall back to slot when none surfaced).
      const childNodes = edges
        .filter((e) => e.fromId === entry.id)
        .map((e) => nodeById.get(e.toId)!)
      node.x =
        childNodes.length > 0
          ? childNodes.reduce((sum, c) => sum + c.x, 0) / childNodes.length
          : nextSlot++
      return
    }

    // Collapsed entry: pass through, accumulating the count.
    const kids = children.get(entry.id) ?? []
    if (kids.length === 0) {
      // Invisible tail — nothing to draw.
      return
    }
    for (const kid of kids) {
      walk({
        entry: kid,
        displayParentId: state.displayParentId,
        collapsed: state.collapsed + 1,
        depth: state.depth,
      })
    }
  }

  for (const root of roots) {
    walk({ entry: root, displayParentId: '__root__', collapsed: 0, depth: 1 })
  }

  // Root centers over its children.
  const rootChildren = edges
    .filter((e) => e.fromId === '__root__')
    .map((e) => nodeById.get(e.toId)!)
  if (rootChildren.length > 0) {
    rootNode.x = rootChildren.reduce((sum, c) => sum + c.x, 0) / rootChildren.length
  }

  return {
    nodes,
    edges,
    maxDepth,
    maxX: Math.max(0, nextSlot - 1),
  }
}
