// Turns records into node/edge data. Only values the runtime gave are shown.
import type { AgentRecord, FlowState, TaskRecord, WorktreeRecord } from '../../shared/model.ts'
import type { ActivityIndex } from './activity.ts'
import { pairActivity } from './activity.ts'
import { agentKindLabel, agentStatus, isAnimatedStatus, shortModel, taskStatus } from './status.ts'
import type { EdgeCategory, FlowEdge, FlowNode, FlowNodeData, FlowNodeKind, NodeDetail, VisualStatus } from './types.ts'

export function agentNode(agent: AgentRecord, state: FlowState, extra: Partial<FlowNodeData> = {}): FlowNode {
  const kind: FlowNodeKind = agent.role === 'lead' ? 'lead' : agent.role === 'subagent' ? 'subagent' : 'agent'
  const role = roleLabel(agent, state)
  const chips: FlowNodeData['chips'] = []
  const details = agentDetails(agent)
  if (agent.failureCount > 0) chips.push({ label: `${agent.failureCount} failure${agent.failureCount > 1 ? 's' : ''}`, tone: 'danger' })
  // Its own turn ended but sub-agents it started are still at work (background agents): not "done".
  const workingSubagents = agent.live || agent.role === 'subagent' ? 0 : liveSubagentsOf(agent.id, state)
  if (workingSubagents) chips.push({ label: `${workingSubagents} sub-agent${workingSubagents > 1 ? 's' : ''} working`, tone: 'accent', title: 'Its own reply is finished; sub-agents it started are still working' })
  const task = agent.taskId ? state.tasks[agent.taskId] : undefined
  const title =
    kind === 'lead'
      ? 'Lead orchestrator'
      : kind === 'subagent'
        ? agent.subagentType && agent.subagentType !== 'general-purpose' ? agent.subagentType : 'Subagent'
        : role ?? agent.title ?? agentKindLabel(agent.agent)
  const subtitle =
    kind === 'lead'
      ? state.runs[agent.runId ?? '']?.objective ?? agent.description
      : kind === 'subagent'
        ? agent.description ?? agent.title
        : distinct(title, task?.displayName, task?.title, agent.description, role ? agent.title : null) ?? agentKindLabel(agent.agent)
  return {
    id: agent.id,
    type: kind,
    position: { x: 0, y: 0 },
    data: {
      kind,
      title,
      subtitle: subtitle ?? null,
      status: workingSubagents ? 'running' : kind === 'lead' ? leadStatus(agent, state) : agentStatus(agent),
      entity: { type: 'agent', id: agent.id },
      live: agent.live,
      chips,
      details,
      since: agent.startedAt,
      until: agent.live ? null : agent.endedAt,
      tokens: agent.tokens,
      progress: kind === 'lead' ? runProgress(agent.runId, state) : null,
      childCount: 0,
      collapsible: false,
      collapsed: false,
      // Only a real reason; the status line already says "Failed".
      error: agent.state === 'failed' && agent.outcome && !/^fail(ed|ure)?$/i.test(agent.outcome) ? agent.outcome : null,
      highlighted: false,
      dimmed: false,
      agentKind: agent.agent,
      ...extra
    }
  }
}

export function taskNode(task: TaskRecord, state: FlowState, extra: Partial<FlowNodeData> = {}): FlowNode {
  const kind: FlowNodeKind = task.kind === 'review' ? 'review' : task.kind === 'test' ? 'test' : 'task'
  const owner = task.assigneeAgentId ? state.agents[task.assigneeAgentId] : undefined
  const chips: FlowNodeData['chips'] = []
  const details: NodeDetail[] = owner ? [{ icon: 'agent', text: [agentKindLabel(owner.agent), shortModel(owner.model), owner.effort].filter(Boolean).join(' · '), title: `Owner: ${owner.title ?? owner.id}${owner.model ? ` (${owner.model})` : ''}` }] : []
  if (owner?.branch) details.push({ icon: 'branch', text: owner.branch, title: `Branch: ${owner.branch}`, mono: true })
  if (task.kind === 'merge') chips.push({ label: 'merge', tone: 'muted', title: 'Kind inferred from the title' })
  if (task.kind === 'plan') chips.push({ label: 'plan', tone: 'muted', title: 'Kind inferred from the title' })
  if (task.retryCount > 0) chips.push({ label: `retry ×${task.retryCount}`, tone: 'warning' })
  if (task.deps.length) chips.push({ label: `${task.deps.length} dep${task.deps.length > 1 ? 's' : ''}`, tone: 'muted' })
  return {
    id: task.id,
    type: kind,
    position: { x: 0, y: 0 },
    data: {
      kind,
      title: task.displayName ?? task.title,
      subtitle: task.displayName ? task.title : null,
      status: taskStatus(task),
      entity: { type: 'task', id: task.id },
      live: Boolean(owner?.live),
      chips,
      details,
      since: owner?.startedAt ?? task.createdAt,
      until: task.completedAt,
      tokens: owner?.tokens ?? null,
      progress: null,
      childCount: 0,
      collapsible: false,
      collapsed: false,
      error: task.state === 'FAILED' ? task.result?.message ?? null : null,
      highlighted: false,
      dimmed: false,
      taskState: task.state,
      agentKind: owner?.agent ?? null,
      ...extra
    }
  }
}

export function worktreeNode(id: string, path: string, worktree: WorktreeRecord | undefined, status: VisualStatus): FlowNode {
  const name = worktree?.name ?? path.split('/').filter(Boolean).pop() ?? path
  return {
    id,
    type: 'worktree',
    position: { x: 0, y: 0 },
    data: {
      kind: 'worktree',
      title: name,
      subtitle: worktree?.branch ?? null,
      status,
      entity: { type: 'worktree', id: worktree?.id ?? path },
      live: false,
      chips: worktree?.project ? [{ label: worktree.project, tone: 'muted' }] : [],
      since: null,
      until: null,
      tokens: null,
      progress: null,
      childCount: 0,
      collapsible: false,
      collapsed: false,
      error: null,
      highlighted: false,
      dimmed: false,
      path
    }
  }
}

export function groupNode(id: string, kind: 'team', title: string, subtitle: string | null, status: VisualStatus, extra: Partial<FlowNodeData> = {}): FlowNode {
  return {
    id,
    type: kind,
    position: { x: 0, y: 0 },
    data: {
      kind,
      title,
      subtitle,
      status,
      entity: { type: 'team', id },
      live: false,
      chips: [],
      since: null,
      until: null,
      tokens: null,
      progress: null,
      childCount: 0,
      collapsible: true,
      collapsed: false,
      error: null,
      highlighted: false,
      dimmed: false,
      ...extra
    }
  }
}

/** Model + effort, branch and account as full rows; missing values are simply left out. */
export function agentDetails(agent: AgentRecord): NodeDetail[] {
  const details: NodeDetail[] = []
  const model = shortModel(agent.model)
  if (model || agent.effort) details.push({ icon: 'model', text: [model ?? agentKindLabel(agent.agent), agent.effort].filter(Boolean).join(' · '), title: [agent.model, agent.effort && `effort ${agent.effort}`].filter(Boolean).join(', ') })
  if (agent.branch) details.push({ icon: 'branch', text: agent.branch, title: `Branch: ${agent.branch}`, mono: true })
  if (agent.account?.label) details.push({ icon: 'account', text: agent.account.label, title: `Account (${agent.account.source === 'session-file' ? 'from session file' : agent.account.source})` })
  return details
}

export function edge(source: string, target: string, category: EdgeCategory, status: VisualStatus, activity: ActivityIndex, liveTarget: boolean, label: string | null = null): FlowEdge {
  const pulse = pairActivity(activity, source, target)
  return {
    id: `${category}:${source}->${target}`,
    source,
    target,
    type: 'flow',
    data: { category, status, active: (isAnimatedStatus(status) && liveTarget) || pulse > 0, pulseKey: pulse, label }
  }
}

/** Aggregate status of a group: the most urgent child status wins. */
export function aggregateStatus(statuses: VisualStatus[]): VisualStatus {
  const order: VisualStatus[] = ['failed', 'blocked', 'running', 'review', 'testing', 'waiting', 'ready', 'unknown', 'idle', 'cancelled', 'done']
  for (const status of order) if (statuses.includes(status)) return status
  return 'unknown'
}

/** First value that adds information beyond the title. */
function distinct(title: string, ...values: (string | null | undefined)[]): string | null {
  for (const value of values) if (value && value.trim() && value.trim() !== title.trim()) return value
  return null
}

function liveSubagentsOf(agentId: string, state: FlowState): number {
  let count = 0
  for (const other of Object.values(state.agents)) if (other.role === 'subagent' && other.parentId === agentId && other.live) count++
  return count
}

function leadStatus(agent: AgentRecord, state: FlowState): VisualStatus {
  const run = agent.runId ? state.runs[agent.runId] : undefined
  if (agent.live) return agentStatus(agent)
  if (!run) return 'unknown'
  return run.state === 'active' ? 'running' : run.state === 'completed' ? 'done' : run.state === 'failed' ? 'failed' : 'idle'
}

function runProgress(runId: string | null, state: FlowState): { done: number; total: number } | null {
  if (!runId) return null
  const tasks = Object.values(state.tasks).filter((task) => task.runId === runId)
  if (!tasks.length) return null
  return { done: tasks.filter((task) => ['DONE', 'MERGED', 'APPROVED', 'CANCELLED'].includes(task.state)).length, total: tasks.length }
}

function roleLabel(agent: AgentRecord, state: FlowState): string | null {
  const roles = state.labels.agentRoles
  return (agent.model && roles[agent.model]) || (agent.title && roles[agent.title]) || (agent.agent && roles[agent.agent]) || null
}
