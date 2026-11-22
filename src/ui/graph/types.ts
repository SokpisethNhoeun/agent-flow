import type { Edge, Node } from '@xyflow/react'

export type NodeDetail = { icon: 'model' | 'branch' | 'account' | 'agent'; text: string; title?: string; mono?: boolean }

export type FlowNodeKind = 'lead' | 'team' | 'agent' | 'subagent' | 'task' | 'review' | 'test' | 'worktree' | 'blocker' | 'project'

export type VisualStatus = 'running' | 'waiting' | 'ready' | 'blocked' | 'failed' | 'review' | 'testing' | 'done' | 'cancelled' | 'idle' | 'unknown'

export type EntityRef = { type: 'agent' | 'task' | 'worktree' | 'gate' | 'team' | 'run'; id: string }

export type FlowNodeData = {
  kind: FlowNodeKind
  title: string
  subtitle: string | null
  status: VisualStatus
  entity: EntityRef
  live: boolean
  /** Short chips: model, effort, account, branch… Missing values are simply absent. */
  chips: { label: string; tone?: 'muted' | 'accent' | 'warning' | 'danger' | 'success'; title?: string }[]
  /** Labelled rows with room for full values (model, branch, account); never squeezed into chips. */
  details?: NodeDetail[]
  /** Duration start (ms) for a ticking timer; null when unknown. */
  since: number | null
  until: number | null
  tokens: number | null
  progress: { done: number; total: number } | null
  childCount: number
  collapsible: boolean
  collapsed: boolean
  error: string | null
  highlighted: boolean
  dimmed: boolean
  [key: string]: unknown
}

export type EdgeCategory = 'hierarchy' | 'assignment' | 'dependency' | 'review' | 'testing' | 'merge' | 'message' | 'worktree' | 'blocker'

export type FlowEdgeData = {
  category: EdgeCategory
  status: VisualStatus
  /** True only with verified recent activity: a live working target or a recent event on this edge. */
  active: boolean
  /** Bumped when a fresh event crosses this edge, to replay a one-shot pulse. */
  pulseKey: number
  label: string | null
  [key: string]: unknown
}

export type FlowNode = Node<FlowNodeData, FlowNodeKind>
export type FlowEdge = Edge<FlowEdgeData, 'flow'>

export type Graph = { nodes: FlowNode[]; edges: FlowEdge[] }
