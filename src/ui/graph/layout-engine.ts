// The dagre layout as a pure function of plain data, so it can run on the main thread or in the
// layout worker with the same result. Positions are top-left corners.
import dagre from '@dagrejs/dagre'
import type { ViewMode } from '../state/view-store.ts'
import type { FlowNodeKind } from './types.ts'

export type LayoutInput = {
  mode: ViewMode
  nodes: { id: string; width: number; height: number }[]
  /** Message edges are left out by the caller: they cross the tree and would distort ranking. */
  edges: { id: string; source: string; target: string }[]
}

export type LayoutPositions = Record<string, { x: number; y: number }>

export function computeLayout(input: LayoutInput): LayoutPositions {
  const g = new dagre.graphlib.Graph({ multigraph: true })
  // Left-to-right for both views: wide fan-outs (a lead with many workers) stack vertically like an
  // indented tree instead of becoming one long row.
  g.setGraph({ rankdir: 'LR', nodesep: input.mode === 'hierarchy' ? 18 : 26, ranksep: input.mode === 'hierarchy' ? 80 : 90, marginx: 24, marginy: 24 })
  g.setDefaultEdgeLabel(() => ({}))
  for (const node of input.nodes) g.setNode(node.id, { width: node.width, height: node.height })
  for (const e of input.edges) if (g.hasNode(e.source) && g.hasNode(e.target)) g.setEdge(e.source, e.target, {}, e.id)
  dagre.layout(g)
  const out: LayoutPositions = {}
  for (const node of input.nodes) {
    const placed = g.node(node.id)
    out[node.id] = placed ? { x: placed.x - node.width / 2, y: placed.y - node.height / 2 } : { x: 0, y: 0 }
  }
  return out
}

/** Same shape → same layout: the cache key (node ids, kinds and tree edges, in order). */
export function layoutKeyOf(mode: ViewMode, nodes: { id: string; kind: FlowNodeKind }[], edges: { id: string }[]): string {
  return `${mode}#${nodes.map((n) => `${n.id}:${n.kind}`).join('|')}#${edges.map((e) => e.id).join('|')}`
}
