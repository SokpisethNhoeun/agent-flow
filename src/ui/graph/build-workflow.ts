// Mode B: how work flows. Run lead → tasks (dependency DAG, parent tasks) → worktrees,
// with decision gates as blocker nodes. Kinds (review/test/merge) are inferred from titles.
import type { FlowState, TaskRecord } from '../../shared/model.ts'
import type { ViewState } from '../state/view-store.ts'
import type { ActivityIndex } from './activity.ts'
import { agentNode, edge, groupNode, taskNode, worktreeNode } from './node-data.ts'
import { isFinished, taskStatus } from './status.ts'
import type { FlowEdge, FlowNode, Graph, VisualStatus } from './types.ts'
import { matchesSearch, visibleTasks } from './visibility.ts'
import { isCollapsed } from './build-hierarchy.ts'

const FINISHED_FOLD_THRESHOLD = 6

export function buildWorkflow(state: FlowState, view: ViewState, activity: ActivityIndex): Graph {
  const nodes: FlowNode[] = []
  const edges: FlowEdge[] = []
  const tasks = visibleTasks(state, view.filters)
  const byRun = new Map<string, TaskRecord[]>()
  for (const task of tasks) {
    const list = byRun.get(task.runId)
    if (list) list.push(task)
    else byRun.set(task.runId, [task])
  }
  const search = view.filters.search

  for (const [runId, runTasks] of byRun) {
    const leadId = `lead:${runId}`
    const lead = state.agents[leadId]
    const collapsed = isCollapsed(view, leadId, !view.filters.activeOnly && state.runs[runId]?.state !== 'active' && view.filters.runId === 'all')
    if (lead) {
      const node = agentNode(lead, state, { childCount: runTasks.length, collapsible: true, collapsed })
      highlight(node, search, state.runs[runId]?.objective)
      nodes.push(node)
    }
    if (collapsed) continue
    // Fold finished tasks nothing unfinished depends on; dependency chains into live work stay drawn.
    const neededBy = new Set(runTasks.filter((t) => !isFinished(taskStatus(t))).flatMap((t) => [...t.deps, ...(t.parentId ? [t.parentId] : [])]))
    const foldable = runTasks.filter((t) => isFinished(taskStatus(t)) && taskStatus(t) !== 'failed' && !neededBy.has(t.id))
    let shownTasks = runTasks
    if (foldable.length > FINISHED_FOLD_THRESHOLD) {
      const groupId = `finished:${leadId}`
      const groupCollapsed = isCollapsed(view, groupId, true)
      nodes.push(groupNode(groupId, 'team', `Finished tasks (${foldable.length})`, 'Completed, nothing waits on them', 'done', { childCount: foldable.length, collapsed: groupCollapsed, groupKind: 'finished' }))
      if (lead) edges.push(edge(leadId, groupId, 'hierarchy', 'done', activity, false))
      if (groupCollapsed) shownTasks = runTasks.filter((t) => !foldable.includes(t))
    }
    const ids = new Set(shownTasks.map((task) => task.id))
    for (const task of shownTasks) {
      const owner = task.assigneeAgentId ? state.agents[task.assigneeAgentId] : undefined
      const node = taskNode(task, state)
      highlight(node, search, task.title, task.displayName, owner?.title, owner?.model)
      nodes.push(node)
      const status = taskStatus(task)
      const liveOwner = Boolean(owner?.live)
      const deps = task.deps.filter((dep) => ids.has(dep))
      if (deps.length) {
        for (const dep of deps) {
          const depTask = state.tasks[dep]
          const category = task.kind === 'review' ? 'review' : task.kind === 'test' ? 'testing' : task.kind === 'merge' ? 'merge' : 'dependency'
          edges.push(edge(dep, task.id, category, depEdgeStatus(depTask, task), activity, liveOwner))
        }
      } else if (task.parentId && ids.has(task.parentId)) {
        edges.push(edge(task.parentId, task.id, 'hierarchy', status, activity, liveOwner))
      } else if (lead) {
        edges.push(edge(leadId, task.id, 'assignment', status, activity, liveOwner, 'delegate'))
      }
      // Blockers: pending decision gates.
      for (const gateId of task.gateIds) {
        const gate = state.gates[gateId]
        if (!gate || gate.status !== 'pending') continue
        const blockerId = `gate:${gateId}`
        nodes.push({
          id: blockerId,
          type: 'blocker',
          position: { x: 0, y: 0 },
          data: {
            kind: 'blocker',
            title: 'Decision gate',
            subtitle: gate.question,
            status: 'blocked',
            entity: { type: 'gate', id: gateId },
            live: false,
            chips: [],
            since: gate.createdAt,
            until: null,
            tokens: null,
            progress: null,
            childCount: 0,
            collapsible: false,
            collapsed: false,
            error: null,
            highlighted: false,
            dimmed: Boolean(search.trim()),
            runId,
            taskId: task.id
          }
        })
        edges.push(edge(blockerId, task.id, 'blocker', 'blocked', activity, false))
      }
      // Worktree the task's worker runs in.
      if (owner?.worktreePath) {
        const wtId = `wt:${owner.worktreePath}`
        if (!nodes.some((n) => n.id === wtId)) {
          const worktree = Object.values(state.worktrees).find((w) => w.path === owner.worktreePath)
          const wtNode = worktreeNode(wtId, owner.worktreePath, worktree, 'idle')
          highlight(wtNode, search, worktree?.branch, owner.worktreePath)
          nodes.push(wtNode)
        }
        edges.push(edge(task.id, wtId, 'worktree', status === 'running' ? 'running' : status === 'done' ? 'done' : 'ready', activity, liveOwner))
      }
    }
  }
  // Worktree node status: busiest task using it.
  for (const node of nodes) {
    if (node.type !== 'worktree') continue
    const incoming = edges.filter((e) => e.target === node.id).map((e) => e.data?.status ?? 'idle')
    node.data.status = incoming.includes('running') ? 'running' : incoming.every((s) => s === 'done') && incoming.length ? 'done' : 'ready'
  }
  return { nodes, edges }
}

function depEdgeStatus(dep: TaskRecord | undefined, task: TaskRecord): VisualStatus {
  if (!dep) return 'ready'
  const depStatus = taskStatus(dep)
  if (depStatus === 'failed') return 'failed'
  if (depStatus === 'cancelled') return 'cancelled'
  if (depStatus !== 'done') return 'blocked'
  return taskStatus(task) === 'done' ? 'done' : taskStatus(task)
}

function highlight(node: FlowNode, search: string, ...values: (string | null | undefined)[]): void {
  if (!search.trim()) return
  const hit = matchesSearch(search, node.data.title, node.data.subtitle, ...values)
  node.data.highlighted = hit
  node.data.dimmed = !hit
}
