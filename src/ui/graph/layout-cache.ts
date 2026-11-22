// Layout results by graph shape, computed on the main thread for small graphs and in the layout
// worker for big ones. While a big layout is computing, a provisional one is returned at once:
// cards that were already laid out keep their place, new cards sit just right of their parent
// (or below everything), so the canvas never freezes. Listeners hear when the real one is ready.
import { computeLayout, type LayoutInput, type LayoutPositions } from './layout-engine.ts'

/** Below this many cards dagre takes a few milliseconds: not worth a round trip to the worker. */
export const ASYNC_MIN_NODES = 60
const CACHE_LIMIT = 64
const RANK_GAP = 80
const ROW_GAP = 18

export type AsyncLayouter = (input: LayoutInput) => Promise<LayoutPositions>

let asyncLayouter: AsyncLayouter | null = null
const cache = new Map<string, LayoutPositions>()
const pending = new Set<string>()
/** The last layout shown in each place (a project box, or the flat canvas): the base for provisional ones. */
const lastBySlot = new Map<string, LayoutPositions>()
const listeners = new Set<() => void>()

export function setAsyncLayouter(layouter: AsyncLayouter | null): void {
  asyncLayouter = layouter
}

export function onLayoutReady(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function resetLayoutCache(): void {
  cache.clear()
  pending.clear()
  lastBySlot.clear()
}

function remember(key: string, positions: LayoutPositions): void {
  cache.set(key, positions)
  if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value!)
}

export function layoutFor(slot: string, key: string, input: LayoutInput): { positions: LayoutPositions; provisional: boolean } {
  const hit = cache.get(key)
  if (hit) {
    cache.delete(key)
    cache.set(key, hit)
    lastBySlot.set(slot, hit)
    return { positions: hit, provisional: false }
  }
  const previous = lastBySlot.get(slot)
  // Small graphs, no worker, or nothing on screen yet to keep (the first paint should be final).
  if (!asyncLayouter || input.nodes.length < ASYNC_MIN_NODES || !previous) {
    const positions = computeLayout(input)
    remember(key, positions)
    lastBySlot.set(slot, positions)
    return { positions, provisional: false }
  }
  if (!pending.has(key)) {
    pending.add(key)
    asyncLayouter(input)
      .catch(() => computeLayout(input))
      .then((positions) => {
        pending.delete(key)
        remember(key, positions)
        for (const listener of listeners) listener()
      })
  }
  return { positions: provisional(previous, input), provisional: true }
}

/** Known cards stay put; a new card goes right of its parent, below that parent's other children. */
export function provisional(previous: LayoutPositions, input: LayoutInput): LayoutPositions {
  const out: LayoutPositions = {}
  const size = new Map(input.nodes.map((n) => [n.id, n]))
  let bottom = 0
  for (const node of input.nodes) {
    const at = previous[node.id]
    if (!at) continue
    out[node.id] = at
    bottom = Math.max(bottom, at.y + node.height)
  }
  const parentOf = new Map<string, string>()
  for (const edge of input.edges) if (!parentOf.has(edge.target)) parentOf.set(edge.target, edge.source)
  const nextRow = new Map<string, number>()
  for (const node of input.nodes) {
    if (out[node.id]) continue
    const parentId = parentOf.get(node.id)
    const parent = parentId ? out[parentId] : undefined
    if (parent) {
      const parentNode = size.get(parentId!)!
      const y = nextRow.get(parentId!) ?? Math.max(parent.y, ...childBottoms(parentId!, input, out))
      out[node.id] = { x: parent.x + parentNode.width + RANK_GAP, y }
      nextRow.set(parentId!, y + node.height + ROW_GAP)
    } else {
      out[node.id] = { x: 24, y: bottom + ROW_GAP }
      bottom += node.height + ROW_GAP
    }
  }
  return out
}

function childBottoms(parentId: string, input: LayoutInput, placed: LayoutPositions): number[] {
  const heights = new Map(input.nodes.map((n) => [n.id, n.height]))
  return input.edges.filter((e) => e.source === parentId && placed[e.target]).map((e) => placed[e.target].y + (heights.get(e.target) ?? 0) + ROW_GAP)
}
