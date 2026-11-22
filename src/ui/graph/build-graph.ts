import type { FlowEvent } from '../../shared/events.ts'
import type { FlowState } from '../../shared/model.ts'
import { layoutKey, type ViewState } from '../state/view-store.ts'
import { buildActivity } from './activity.ts'
import { buildHierarchy } from './build-hierarchy.ts'
import { buildWorkflow } from './build-workflow.ts'
import { layoutInput } from './layout.ts'
import { layoutFor } from './layout-cache.ts'
import { layoutKeyOf } from './layout-engine.ts'
import type { Graph } from './types.ts'

/** Nodes and edges without positions. Cheap; runs on every change. */
export function buildRawGraph(state: FlowState, events: readonly FlowEvent[], view: ViewState, now: number): Graph {
  const activity = buildActivity(events, now)
  const raw = view.mode === 'hierarchy' ? buildHierarchy(state, view, activity, now) : buildWorkflow(state, view, activity)
  const nodes = dedupe(raw.nodes)
  const ids = new Set(nodes.map((node) => node.id))
  const edges = dedupe(raw.edges).filter((e) => ids.has(e.source) && ids.has(e.target))
  return { nodes, edges }
}

/** Changes only when the graph's shape changes, not when statuses or timers tick. */
export function structureKey(graph: Graph): string {
  return graph.nodes.map((n) => `${n.id}:${n.data.kind}`).join('|') + '#' + graph.edges.filter((e) => e.data?.category !== 'message').map((e) => e.id).join('|')
}

/** Dagre layout positions; the expensive part, memoized by structure. */
export function layoutPositions(graph: Graph, view: ViewState): Map<string, { x: number; y: number }> {
  const input = layoutInput(graph, view.mode)
  const key = layoutKeyOf(view.mode, graph.nodes.map((n) => ({ id: n.id, kind: n.data.kind })), input.edges)
  const { positions } = layoutFor(`flat:${view.mode}`, key, input)
  const manual = view.positions[layoutKey(view)] ?? {}
  return new Map(graph.nodes.map((n) => [n.id, manual[n.id] ?? positions[n.id] ?? { x: 0, y: 0 }]))
}

/** Both views read the same state; only presentation differs. */
export function buildGraph(state: FlowState, events: readonly FlowEvent[], view: ViewState, now: number): Graph {
  const raw = buildRawGraph(state, events, view, now)
  const positions = layoutPositions(raw, view)
  return { nodes: raw.nodes.map((n) => ({ ...n, position: positions.get(n.id) ?? n.position })), edges: raw.edges }
}

function dedupe<T extends { id: string }>(items: T[]): T[] {
  const seen = new Set<string>()
  return items.filter((item) => (seen.has(item.id) ? false : (seen.add(item.id), true)))
}
