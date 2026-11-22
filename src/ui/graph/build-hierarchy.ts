// Mode A: who works for whom. Lead → teams (by account label) → agents → subagents.
// Standalone agents (not in a Run) group under their worktree.
import type { AgentRecord, FlowState } from '../../shared/model.ts'
import type { ViewState } from '../state/view-store.ts'
import type { ActivityIndex } from './activity.ts'
import { agentNode, aggregateStatus, edge, groupNode } from './node-data.ts'
import { agentKindLabel, agentStatus } from './status.ts'
import type { FlowEdge, FlowNode, Graph } from './types.ts'
import { matchesSearch, visibleAgents } from './visibility.ts'

const FINISHED_FOLD_THRESHOLD = 4

export function buildHierarchy(state: FlowState, view: ViewState, activity: ActivityIndex, now: number): Graph {
  const nodes: FlowNode[] = []
  const edges: FlowEdge[] = []
  const agents = visibleAgents(state, view.filters, now)
  const visible = new Set(agents.map((agent) => agent.id))
  const children = new Map<string, AgentRecord[]>()
  for (const agent of agents) {
    if (agent.role === 'subagent' && agent.parentId && visible.has(agent.parentId)) push(children, agent.parentId, agent)
  }
  const search = view.filters.search

  const addAgent = (agent: AgentRecord, parentId: string | null, parentLive = true) => {
    const kids = children.get(agent.id) ?? []
    const collapsed = Boolean(view.collapsed[agent.id])
    const node = agentNode(agent, state, { childCount: kids.length, collapsible: kids.length > 0, collapsed })
    decorate(node, search, agent.title, agent.description, agent.model, agent.account?.label, agent.branch, agent.agent)
    nodes.push(node)
    if (parentId) edges.push(edge(parentId, agent.id, agent.role === 'subagent' ? 'hierarchy' : 'assignment', agentStatus(agent), activity, agent.live && parentLive))
    if (!collapsed) for (const kid of kids) addAgent(kid, agent.id, agent.live)
  }

  /** Finished workers fold into one "Finished (N)" group per parent so active work stays readable. */
  const addMembers = (members: AgentRecord[], parentId: string) => {
    const finished = members.filter((m) => !m.live && (m.state === 'done' || m.state === 'idle'))
    const shown = finished.length > FINISHED_FOLD_THRESHOLD ? members.filter((m) => !finished.includes(m)) : members
    for (const member of shown) addAgent(member, parentId)
    if (shown.length === members.length) return
    const groupId = `finished:${parentId}`
    const collapsed = isCollapsed(view, groupId, true)
    const group = groupNode(groupId, 'team', `Finished (${finished.length})`, 'Completed workers', 'done', { childCount: finished.length, collapsed, groupKind: 'finished' })
    nodes.push(group)
    edges.push(edge(parentId, groupId, 'hierarchy', 'done', activity, false))
    if (!collapsed) for (const member of finished) addAgent(member, groupId)
  }

  // Runs: Lead → (team) → workers.
  const leads = agents.filter((agent) => agent.role === 'lead')
  for (const lead of leads) {
    const workers = agents.filter((agent) => agent.role === 'worker' && agent.runId === lead.runId && (!agent.parentId || agent.parentId === lead.id || !visible.has(agent.parentId)))
    const leadCollapsed = isCollapsed(view, lead.id, !view.filters.activeOnly && state.runs[lead.runId ?? '']?.state !== 'active' && view.filters.runId === 'all')
    const leadNode = agentNode(lead, state, { childCount: workers.length, collapsible: workers.length > 0, collapsed: leadCollapsed })
    decorate(leadNode, search, lead.description, state.runs[lead.runId ?? '']?.objective)
    nodes.push(leadNode)
    if (leadCollapsed) continue
    // The lead's own subagents (a coordinator can delegate too).
    for (const kid of children.get(lead.id) ?? []) addAgent(kid, lead.id, lead.live)
    const teams = new Map<string, AgentRecord[]>()
    const direct: AgentRecord[] = []
    for (const worker of workers) {
      const team = teamName(worker, state)
      if (team) push(teams, team, worker)
      else direct.push(worker)
    }
    for (const [team, members] of teams) {
      const teamId = `team:${lead.runId}:${team}`
      const collapsed = Boolean(view.collapsed[teamId])
      const teamNode = groupNode(teamId, 'team', team, members[0]?.account?.label && members[0].account.label !== team ? members[0].account.label : agentKindLabel(members[0]?.agent ?? null), aggregateStatus(members.map(agentStatus)), {
        childCount: members.length,
        collapsed,
        live: members.some((member) => member.live)
      })
      decorate(teamNode, search, team)
      nodes.push(teamNode)
      edges.push(edge(lead.id, teamId, 'hierarchy', teamNode.data.status, activity, teamNode.data.live))
      if (!collapsed) addMembers(members, teamId)
    }
    addMembers(direct, lead.id)
    // Nested workers (a worker that coordinates its own workers).
    for (const worker of agents.filter((a) => a.role === 'worker' && a.parentId && a.parentId !== lead.id && visible.has(a.parentId) && a.runId === lead.runId)) {
      if (nodes.some((node) => node.id === worker.id)) continue
      addAgent(worker, worker.parentId)
    }
  }

  // Agents outside any Run, grouped by worktree.
  const standalone = agents.filter((agent) => agent.role === 'agent' || (agent.role === 'subagent' && (!agent.parentId || !visible.has(agent.parentId))) || (agent.role === 'worker' && !agent.runId))
  const byWorktree = new Map<string, AgentRecord[]>()
  for (const agent of standalone) push(byWorktree, agent.worktreePath ?? agent.workspaceId ?? 'unknown', agent)
  for (const [key, members] of byWorktree) {
    const worktree = Object.values(state.worktrees).find((w) => w.path === key || w.id === key)
    const groupId = `ws:${key}`
    const collapsed = Boolean(view.collapsed[groupId])
    const group = groupNode(groupId, 'team', worktree?.name ?? (key === 'unknown' ? 'Unattributed agents' : key.split('/').pop() ?? key), worktree?.branch ?? 'Agents outside an orchestration run', aggregateStatus(members.map(agentStatus)), {
      childCount: members.length,
      collapsed,
      live: members.some((member) => member.live),
      groupKind: 'workspace'
    })
    decorate(group, search, worktree?.name, worktree?.branch, key)
    nodes.push(group)
    if (!collapsed) for (const member of members) addAgent(member, groupId)
  }

  // Verified agent-to-agent communication (orchestration messages), shown while recent.
  const shown = new Set(nodes.map((node) => node.id))
  for (const message of state.messages.slice(-80)) {
    if (!message.fromAgentId || !message.toAgentId || !shown.has(message.fromAgentId) || !shown.has(message.toAgentId)) continue
    if (now - message.createdAt > 60_000) continue
    const e = edge(message.fromAgentId, message.toAgentId, 'message', 'running', activity, false, message.type)
    e.id = `message:${message.id}`
    if (!edges.some((existing) => existing.id === e.id)) edges.push(e)
  }
  return { nodes, edges }
}

/** Team = the person's label for the account, else the account email. Unknown accounts: no team. */
function teamName(agent: AgentRecord, state: FlowState): string | null {
  const account = agent.account
  if (!account) return null
  const labels = state.labels.accountTeams
  return (account.accountId && labels[account.accountId]) || account.label || null
}

/** Explicit choice wins; otherwise finished runs start collapsed so active work stands out. */
export function isCollapsed(view: ViewState, id: string, byDefault: boolean): boolean {
  return view.collapsed[id] ?? byDefault
}

function decorate(node: FlowNode, search: string, ...values: (string | null | undefined)[]): void {
  if (!search.trim()) return
  const hit = matchesSearch(search, node.data.title, node.data.subtitle, ...values)
  node.data.highlighted = hit
  node.data.dimmed = !hit
}

function push<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key)
  if (list) list.push(value)
  else map.set(key, [value])
}
