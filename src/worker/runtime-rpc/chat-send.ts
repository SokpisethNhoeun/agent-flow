// Sends a user message into an Orca chat session exactly as Orca's own chat composer does:
// read the session's current fence, fingerprint the payload, then `agentSession.send`.
import { createHash, randomUUID } from 'node:crypto'
import { callOrcaRuntime } from './orca-runtime-client.ts'

const STRUCTURED_PREFIX = 'structured-agent-session-'

/** A chat tab's pane key is `structured-agent-session-<Orca session id>:<tab>`. */
export function chatSessionIdFromPaneKey(paneKey: string | null | undefined): string | null {
  if (!paneKey?.startsWith(STRUCTURED_PREFIX)) return null
  const id = paneKey.slice(STRUCTURED_PREFIX.length).split(':')[0]
  return /^[A-Za-z0-9_-]{4,200}$/.test(id) ? id : null
}

/** Orca's canonical JSON (sorted keys, undefined dropped), matching its payload fingerprint. */
export function canonicalize(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value ?? null)
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalize(entry)}`).join(',')}}`
}

export function payloadFingerprint(method: string, sessionId: string, fields: Record<string, unknown>): string {
  return createHash('sha256').update(canonicalize({ method, sessionId, fields }), 'utf8').digest('hex')
}

export function operationId(now = Date.now()): string {
  return `${Math.trunc(now)}-${randomUUID().replaceAll('-', '').toLowerCase()}`
}

type HistoryPage = { page?: { fence?: number } }

export async function sendChatMessage(sessionId: string, text: string): Promise<{ accepted: true }> {
  const history = await callOrcaRuntime<HistoryPage>('agentSession.history', { sessionId, direction: 'tail', limit: 1 })
  const fence = history.page?.fence
  if (typeof fence !== 'number') throw new Error('Orca did not report this chat session’s state.')
  // Queue behind a running turn, as Orca's composer does, instead of being refused.
  const fields = { body: { kind: 'message', role: 'user', blocks: [{ type: 'text', text }] }, delivery: 'queue-if-active' as const }
  await callOrcaRuntime('agentSession.send', {
    envelope: { sessionId, clientOperationId: operationId(), expectedRuntimeFence: fence, payloadFingerprint: payloadFingerprint('agentSession.send', sessionId, fields) },
    ...fields
  })
  return { accepted: true }
}
