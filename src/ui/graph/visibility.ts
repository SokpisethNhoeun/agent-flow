// Which records a view shows, given the filters. Search only highlights; it never hides.
import type { AgentRecord, FlowState, TaskRecord } from '../../shared/model.ts'
import type { Filters } from '../state/view-store.ts'
import { agentStatus, isFinished, taskStatus } from './status.ts'

const STANDALONE_STALE_MS = 2 * 60 * 60 * 1000

const ACTIVE_STATES = new Set(['working', 'waiting', 'blocked'])

/** Live evidence and an active state; nothing restored or inferred counts. */
export function isActiveAgent(agent: AgentRecord): boolean {
  return agent.live && ACTIVE_STATES.has(agent.state)
}

export function visibleAgents(state: FlowState, filters: Filters, now: number): AgentRecord[] {
  if (filters.activeOnly) return activeAgentsWithAncestors(state, filters)
  const agents = Object.values(state.agents)
  const superseded = new Set(agents.map((agent) => agent.retryOfDispatchId).filter((id): id is string => Boolean(id)))
  return agents.filter((agent) => {
    if (filters.runId !== 'all' && agent.runId !== filters.runId) return false
    if (agent.dispatchId && superseded.has(agent.dispatchId)) return false
    const status = agentStatus(agent)
    if (!filters.showFinished && agent.role !== 'lead' && isFinished(status) && status !== 'failed') return false
    if (agent.role === 'agent' && !agent.runId && !agent.live) {
      if (!filters.showIdle) return false
      if (now - agent.lastSeenAt > STANDALONE_STALE_MS) return false
    }
    if (agent.role === 'lead' && filters.runId === 'all' && !filters.showFinished) {
      const run = state.runs[agent.runId ?? '']
      if (run && run.state !== 'active') return false
    }
    return true
  })
}

/** Active agents plus the chain that connects them (parents, their run's lead). */
function activeAgentsWithAncestors(state: FlowState, filters: Filters): AgentRecord[] {
  const keep = new Map<string, AgentRecord>()
  for (const agent of Object.values(state.agents)) {
    if (!isActiveAgent(agent) || agent.role === 'lead') continue
    if (filters.runId !== 'all' && agent.runId !== filters.runId) continue
    let cursor: AgentRecord | undefined = agent
    while (cursor && !keep.has(cursor.id)) {
      keep.set(cursor.id, cursor)
      cursor = cursor.parentId ? state.agents[cursor.parentId] : undefined
    }
    const lead = agent.runId ? state.agents[`lead:${agent.runId}`] : undefined
    if (lead) keep.set(lead.id, lead)
  }
  return [...keep.values()]
}

const ACTIVE_TASK_STATES = new Set(['RUNNING', 'REVIEW', 'TESTING', 'BLOCKED', 'RETRYING'])

export function visibleTasks(state: FlowState, filters: Filters): TaskRecord[] {
  return Object.values(state.tasks).filter((task) => {
    if (filters.runId !== 'all' && task.runId !== filters.runId) return false
    if (filters.activeOnly) {
      // In progress, or owned by an agent with live evidence of working.
      const owner = task.assigneeAgentId ? state.agents[task.assigneeAgentId] : undefined
      return ACTIVE_TASK_STATES.has(task.state) || Boolean(owner && isActiveAgent(owner))
    }
    if (!filters.showFinished) {
      const status = taskStatus(task)
      if (isFinished(status) && status !== 'failed') return false
    }
    return true
  })
}

export function matchesSearch(search: string, ...values: (string | null | undefined)[]): boolean {
  const q = search.trim().toLowerCase()
  if (!q) return false
  return values.some((value) => value?.toLowerCase().includes(q))
}
