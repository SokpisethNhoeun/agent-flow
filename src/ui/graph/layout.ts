// Automatic DAG layout (dagre). Manual positions the person dragged win over the layout.
import type { LayoutInput } from './layout-engine.ts'
import type { ViewMode } from '../state/view-store.ts'
import type { FlowNodeKind, Graph } from './types.ts'

export const NODE_SIZE: Record<FlowNodeKind, { width: number; height: number }> = {
  lead: { width: 300, height: 124 },
  team: { width: 240, height: 84 },
  agent: { width: 300, height: 150 },
  subagent: { width: 280, height: 100 },
  task: { width: 300, height: 138 },
  review: { width: 300, height: 138 },
  test: { width: 300, height: 138 },
  worktree: { width: 220, height: 72 },
  blocker: { width: 220, height: 80 },
  /** Project boxes are sized from their content; this is the collapsed size. */
  project: { width: 340, height: 64 }
}

/** Dagre input for a graph: card sizes, and the tree edges (message edges cross it and are left out). */
export function layoutInput(graph: Graph, mode: ViewMode): LayoutInput {
  return {
    mode,
    nodes: graph.nodes.map((node) => ({ id: node.id, ...NODE_SIZE[node.data.kind] })),
    edges: graph.edges.filter((e) => e.data?.category !== 'message').map((e) => ({ id: e.id, source: e.source, target: e.target }))
  }
}
