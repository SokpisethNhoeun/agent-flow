// Folds a duplicate agent record into the canonical one (an orchestration dispatch wins), keeping
// everything the duplicate learned (session, account, tokens, terminal) and removing it.
import type { AgentRecord } from '../../shared/model.ts'
import type { IdentityIndex } from './identity-index.ts'
import { samePaneKey } from './identity-index.ts'
import type { FlowStore } from './store.ts'

const CARRY: (keyof AgentRecord)[] = ['sessionId', 'terminalId', 'account', 'tokens', 'messageCount', 'agent', 'model', 'effort', 'branch', 'worktreePath', 'workspaceId']

export function mergeAgentInto(store: FlowStore, identity: IdentityIndex, targetId: string, sourceId: string): void {
  if (targetId === sourceId) return
  const state = store.read()
  const target = state.agents[targetId]
  const source = state.agents[sourceId]
  if (!target || !source) return
  const patch: Partial<AgentRecord> = { evidence: source.evidence }
  for (const key of CARRY) if (target[key] == null && source[key] != null) (patch as Record<string, unknown>)[key] = source[key]
  // Live status from host events is more precise than the durable poll; keep the newer one.
  if (source.lastSeenAt > target.lastSeenAt) Object.assign(patch, { state: source.state, live: source.live, stateSince: source.stateSince })
  store.upsertAgent(targetId, Math.max(source.lastSeenAt, target.lastSeenAt), patch, () => target)
  // Children (subagents) follow their parent.
  for (const agent of Object.values(state.agents)) if (agent.parentId === sourceId) store.upsertAgent(agent.id, agent.lastSeenAt, { parentId: targetId }, () => agent)
  store.removeAgent(sourceId)
  identity.unlinkAgent(sourceId)
  identity.link(targetId, { terminalId: source.terminalId, sessionId: source.sessionId, paneKey: source.paneKey })
}

const rank = (agent: AgentRecord) => (agent.dispatchId ? 3 : agent.role === 'lead' ? 2 : 1)

/**
 * After any observation: if another record names the same agent (same terminal, session or
 * structured-session pane), fold the weaker one into the stronger one (dispatch > lead > plain),
 * so one agent is never drawn twice and no orphan stays "live".
 */
export function dedupeAgent(store: FlowStore, identity: IdentityIndex, agentId: string): string {
  const agent = store.read().agents[agentId]
  if (!agent || agent.role === 'subagent') return agentId
  let survivor = agent
  for (const other of Object.values(store.read().agents)) {
    if (other.id === survivor.id || other.role === 'subagent') continue
    // Two different dispatches are two attempts, never the same agent.
    if (other.dispatchId && survivor.dispatchId) continue
    const same =
      (other.terminalId && other.terminalId === survivor.terminalId) ||
      (other.sessionId && other.sessionId === survivor.sessionId) ||
      samePaneKey(other.paneKey, survivor.paneKey)
    if (!same) continue
    const keepOther = rank(other) > rank(survivor) || (rank(other) === rank(survivor) && other.lastSeenAt > survivor.lastSeenAt)
    const [target, source] = keepOther ? [other, survivor] : [survivor, other]
    mergeAgentInto(store, identity, target.id, source.id)
    survivor = store.read().agents[target.id] ?? target
  }
  return survivor.id
}

/** Merges every non-dispatch record that shares a pane/session with a dispatch record. */
export function mergeDuplicatesOf(store: FlowStore, identity: IdentityIndex, dispatchAgentId: string): void {
  const target = store.read().agents[dispatchAgentId]
  if (!target?.paneKey) return
  for (const agent of Object.values(store.read().agents)) {
    if (agent.id === dispatchAgentId || agent.dispatchId || agent.role === 'lead' || agent.role === 'subagent') continue
    if (samePaneKey(agent.paneKey, target.paneKey)) mergeAgentInto(store, identity, dispatchAgentId, agent.id)
  }
}
