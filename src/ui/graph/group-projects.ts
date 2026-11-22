// Project boxes: every node is assigned to the project it works in (a lead goes where most of its
// workers are, option A), each box is laid out on its own, then the boxes are packed on the canvas.
import type { FlowState } from '../../shared/model.ts'
import type { ViewState } from '../state/view-store.ts'
import { layoutInput } from './layout.ts'
import { layoutFor } from './layout-cache.ts'
import { layoutKeyOf } from './layout-engine.ts'
import { OTHER_PROJECT, ProjectResolver, type ProjectInfo } from './projects.ts'
import { aggregateStatus } from './node-data.ts'
import type { FlowEdge, FlowNode, Graph } from './types.ts'

export const BOX_PAD = 28
export const BOX_HEADER = 56
const BOX_GAP = 40
const COLLAPSED_BOX = { width: 340, height: BOX_HEADER + 8 }

export type Assignment = Map<string, ProjectInfo>

/** Which project each node belongs to. */
export function assignProjects(graph: Graph, state: FlowState): Assignment {
  const resolver = new ProjectResolver(state)
  const out: Assignment = new Map()
  const placeOf = (node: FlowNode): { path: string | null; repoRoot: string | null; projectId: string | null } | undefined => {
    const e = node.data.entity
    const of = (agent: FlowState['agents'][string] | undefined) => ({ path: agent?.worktreePath ?? null, repoRoot: agent?.repoRoot ?? null, projectId: agent?.projectId ?? null })
    if (e.type === 'agent') {
      const agent = state.agents[e.id]
      if (!agent || agent.role === 'lead') return undefined
      return agent.worktreePath || agent.projectId ? of(agent) : of(agent.parentId ? state.agents[agent.parentId] : undefined)
    }
    if (e.type === 'task') {
      const task = state.tasks[e.id]
      const owner = task?.assigneeAgentId ? state.agents[task.assigneeAgentId] : undefined
      return owner?.worktreePath || owner?.projectId ? of(owner) : undefined
    }
    if (node.type === 'worktree') return { path: typeof node.data.path === 'string' ? node.data.path : null, repoRoot: null, projectId: null }
    return undefined // groups, leads, blockers: decided by their neighbours below
  }
  for (const node of graph.nodes) {
    const place = placeOf(node)
    if (place !== undefined) out.set(node.id, resolver.resolve(place.path, place.repoRoot, place.projectId))
  }
  // Groups, leads and blockers follow the majority of what they connect to (children first).
  const children = new Map<string, string[]>()
  const neighbours = new Map<string, string[]>()
  for (const e of graph.edges) {
    if (e.data?.category === 'message') continue
    children.set(e.source, [...(children.get(e.source) ?? []), e.target])
    neighbours.set(e.source, [...(neighbours.get(e.source) ?? []), e.target])
    neighbours.set(e.target, [...(neighbours.get(e.target) ?? []), e.source])
  }
  for (let pass = 0; pass < 4; pass++) {
    let changed = false
    for (const node of graph.nodes) {
      if (out.has(node.id)) continue
      const pick = majority((children.get(node.id)?.length ? children.get(node.id)! : neighbours.get(node.id) ?? []).map((id) => out.get(id)).filter((p): p is ProjectInfo => Boolean(p)))
      if (pick) {
        out.set(node.id, pick)
        changed = true
      }
    }
    if (!changed) break
  }
  const other = resolver.resolve(null)
  for (const node of graph.nodes) if (!out.has(node.id)) out.set(node.id, node.data.kind === 'lead' ? leadFallback(node, state, resolver) ?? other : other)
  return out
}

function leadFallback(node: FlowNode, state: FlowState, resolver: ProjectResolver): ProjectInfo | null {
  const runId = state.agents[node.id]?.runId
  if (!runId) return null
  const paths = Object.values(state.agents).filter((a) => a.runId === runId && a.worktreePath).map((a) => resolver.resolve(a.worktreePath, a.repoRoot, a.projectId))
  return majority(paths)
}

function majority(infos: ProjectInfo[]): ProjectInfo | null {
  if (!infos.length) return null
  const counts = new Map<string, { info: ProjectInfo; n: number }>()
  for (const info of infos) counts.set(info.key, { info, n: (counts.get(info.key)?.n ?? 0) + 1 })
  return [...counts.values()].sort((a, b) => b.n - a.n || (a.info.key === OTHER_PROJECT ? 1 : -1))[0].info
}

export function assignmentKey(assignment: Assignment): string {
  return [...assignment.entries()].map(([id, p]) => `${id}>${p.key}`).join('|')
}

export type BoxLayout = { key: string; x: number; y: number; width: number; height: number; collapsed: boolean }

export type ProjectLayout = { boxes: BoxLayout[]; positions: Map<string, { x: number; y: number }> }

/** The expensive part: dagre per box plus packing. Memoize on structure. */
export function layoutProjects(graph: Graph, assignment: Assignment, view: ViewState, manual: Record<string, { x: number; y: number }>): ProjectLayout {
  const members = new Map<string, FlowNode[]>()
  for (const node of graph.nodes) {
    const key = assignment.get(node.id)?.key ?? OTHER_PROJECT
    const list = members.get(key)
    if (list) list.push(node)
    else members.set(key, [node])
  }
  const positions = new Map<string, { x: number; y: number }>()
  const sized: { key: string; width: number; height: number; collapsed: boolean; live: number; name: string }[] = []
  for (const [key, nodes] of members) {
    const boxId = boxNodeId(key)
    const collapsed = view.collapsed[boxId] ?? false
    const info = assignment.get(nodes[0].id)!
    const live = nodes.filter((n) => n.data.live).length
    if (collapsed) {
      sized.push({ key, ...COLLAPSED_BOX, collapsed, live, name: info.name })
      continue
    }
    const ids = new Set(nodes.map((n) => n.id))
    const edges = graph.edges.filter((e) => ids.has(e.source) && ids.has(e.target))
    const { relative, minX, minY, maxX, maxY } = layoutBox(key, nodes, edges, view.mode)
    for (const [id, position] of relative) {
      // Positions inside a box are relative to it; a node the person dragged keeps its place.
      positions.set(id, manual[id] ?? position)
    }
    const saved = view.boxSizes?.[key]
    const width = Math.max(maxX - minX + BOX_PAD * 2, saved?.width ?? 0, 320)
    const height = Math.max(maxY - minY + BOX_HEADER + BOX_PAD * 1.5, saved?.height ?? 0, 140)
    sized.push({ key, width, height, collapsed, live, name: info.name })
  }
  // Busiest projects first, "Other" last; one project per row, stacked vertically. All boxes
  // share the widest box's width so their edges line up like a list.
  sized.sort((a, b) => Number(a.key === OTHER_PROJECT) - Number(b.key === OTHER_PROJECT) || b.live - a.live || a.name.localeCompare(b.name))
  const columnWidth = Math.max(...sized.filter((b) => !b.collapsed).map((b) => b.width), COLLAPSED_BOX.width)
  const boxes: BoxLayout[] = []
  let y = 0
  for (const box of sized) {
    const width = view.boxSizes?.[box.key]?.width ?? (box.collapsed ? COLLAPSED_BOX.width : columnWidth)
    const placed = manual[boxNodeId(box.key)] ?? { x: 0, y }
    boxes.push({ key: box.key, x: placed.x, y: placed.y, width, height: box.height, collapsed: box.collapsed })
    y += box.height + BOX_GAP
  }
  return { boxes, positions }
}

type LaidBox = { relative: Map<string, { x: number; y: number }>; minX: number; minY: number; maxX: number; maxY: number }

/** One box's layout, from the shared layout cache (a change in one box re-lays only that box). */
function layoutBox(boxKey: string, nodes: FlowNode[], edges: FlowEdge[], mode: ViewState['mode']): LaidBox {
  const input = layoutInput({ nodes, edges }, mode)
  const { positions } = layoutFor(`box:${boxKey}:${mode}`, layoutKeyOf(mode, nodes.map((n) => ({ id: n.id, kind: n.data.kind })), input.edges), input)
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const n of input.nodes) {
    const p = positions[n.id] ?? { x: 0, y: 0 }
    minX = Math.min(minX, p.x)
    minY = Math.min(minY, p.y)
    maxX = Math.max(maxX, p.x + n.width)
    maxY = Math.max(maxY, p.y + n.height)
  }
  const relative = new Map(input.nodes.map((n) => [n.id, { x: (positions[n.id]?.x ?? 0) - minX + BOX_PAD, y: (positions[n.id]?.y ?? 0) - minY + BOX_HEADER + BOX_PAD / 2 }]))
  return { relative, minX, minY, maxX, maxY }
}

export function boxNodeId(key: string): string {
  return `box:${key}`
}

/** Builds the final node list: box nodes first (React Flow needs parents before children). */
export function assembleProjectGraph(graph: Graph, assignment: Assignment, layout: ProjectLayout, state: FlowState): Graph {
  const byBox = new Map<string, FlowNode[]>()
  for (const node of graph.nodes) {
    const key = assignment.get(node.id)?.key ?? OTHER_PROJECT
    byBox.set(key, [...(byBox.get(key) ?? []), node])
  }
  const nodes: FlowNode[] = []
  const visible = new Set<string>()
  for (const box of layout.boxes) {
    const members = byBox.get(box.key) ?? []
    const info = assignment.get(members[0]?.id ?? '')
    const kinds = [...new Set(members.map((m) => (typeof m.data.agentKind === 'string' ? m.data.agentKind : null)).filter((k): k is string => Boolean(k)))]
    // In the workflow view the boxes hold tasks: count the agents working them too.
    const taskIds = members.filter((m) => m.data.entity.type === 'task').map((m) => m.data.entity.id)
    const owners = taskIds.map((id) => state.tasks[id]?.assigneeAgentId).filter((id): id is string => Boolean(id))
    const agentIds = [...new Set([...members.filter((m) => m.data.entity.type === 'agent' && m.data.kind !== 'lead').map((m) => m.data.entity.id), ...owners])]
    const liveAgents = agentIds.filter((id) => state.agents[id]?.live).length
    nodes.push({
      id: boxNodeId(box.key),
      type: 'project',
      position: { x: box.x, y: box.y },
      width: box.width,
      height: box.height,
      style: { width: box.width, height: box.height },
      selectable: true,
      draggable: true,
      zIndex: -1,
      data: {
        kind: 'project',
        title: info?.name ?? 'Other',
        subtitle: info?.path ?? (info?.source === 'rule' ? 'Your path rule' : info?.source === 'other' ? 'No project path reported' : null),
        status: aggregateStatus(members.map((m) => m.data.status)),
        entity: { type: 'team', id: boxNodeId(box.key) },
        live: liveAgents > 0,
        chips: [],
        since: null,
        until: null,
        tokens: null,
        progress: null,
        childCount: members.length,
        collapsible: true,
        collapsed: box.collapsed,
        error: null,
        highlighted: false,
        dimmed: false,
        projectKey: box.key,
        projectColor: info?.color ?? null,
        projectSource: info?.source ?? 'other',
        liveAgents,
        agentCount: agentIds.length,
        taskCount: taskIds.length,
        agentKinds: kinds
      }
    })
    if (box.collapsed) continue
    for (const member of members) {
      visible.add(member.id)
      nodes.push({ ...member, parentId: boxNodeId(box.key), extent: 'parent', position: layout.positions.get(member.id) ?? member.position })
    }
  }
  const edges: FlowEdge[] = graph.edges.filter((e) => visible.has(e.source) && visible.has(e.target))
  return { nodes, edges }
}
