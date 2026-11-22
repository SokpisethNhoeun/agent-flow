// Links the different ids Orca uses for one agent (terminal id, orchestration terminal handle,
// pane key, session id) so a status event and an orchestration dispatch land on the same node.

export type AgentKeys = {
  terminalId?: string | null
  terminalHandle?: string | null
  paneKey?: string | null
  sessionId?: string | null
}

export class IdentityIndex {
  private byKey = new Map<string, string>()

  link(agentId: string, keys: AgentKeys): void {
    for (const key of keyList(keys)) {
      // Orchestration dispatch ids win over plain terminal ids: they carry more context.
      const existing = this.byKey.get(key)
      if (existing && existing.startsWith('dispatch:') && !agentId.startsWith('dispatch:')) continue
      this.byKey.set(key, agentId)
    }
  }

  resolve(keys: AgentKeys): string | null {
    for (const key of keyList(keys)) {
      const id = this.byKey.get(key)
      if (id) return id
    }
    return null
  }

  unlinkAgent(agentId: string): void {
    for (const [key, id] of this.byKey) if (id === agentId) this.byKey.delete(key)
  }
}

function keyList(keys: AgentKeys): string[] {
  const out: string[] = []
  if (keys.paneKey) out.push(`pane:${normalizePaneKey(keys.paneKey)}`)
  if (keys.terminalHandle) out.push(`handle:${keys.terminalHandle}`)
  if (keys.terminalId) out.push(`term:${keys.terminalId}`)
  if (keys.sessionId) out.push(`session:${keys.sessionId}`)
  return out
}

/**
 * Structured (chat) sessions use `structured-agent-session-<session>:<pane instance>`; status events
 * and orchestration dispatches name different instances of the same session, so match on the
 * session part. Terminal pane keys (`<tab group>:<pane>`) stay exact: the group is shared.
 */
export function normalizePaneKey(paneKey: string): string {
  if (paneKey.startsWith('structured-agent-session-')) return paneKey.split(':')[0]
  return paneKey
}

/** Agents (other than `except`) whose pane key names the same pane or structured session. */
export function samePaneKey(a: string | null, b: string | null): boolean {
  return Boolean(a && b && normalizePaneKey(a) === normalizePaneKey(b))
}
