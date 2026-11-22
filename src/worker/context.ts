import type { OrcaWorkerApi } from 'orca/worker'
import type { AgentRecord, AgentRole } from '../shared/model.ts'
import type { CliRunner } from './cli/orca-cli.ts'
import type { FlowStore } from './state/store.ts'
import type { IdentityIndex } from './state/identity-index.ts'

/** Everything an adapter or command handler needs; tests pass fakes. */
export type WorkerContext = {
  orca: Pick<OrcaWorkerApi, 'host' | 'log'> & Partial<Pick<OrcaWorkerApi, 'panels' | 'storage' | 'settings' | 'secrets' | 'events' | 'hooks' | 'api'>>
  store: FlowStore
  cli: CliRunner
  identity: IdentityIndex
  now: () => number
  log: (message: string) => void
}

export function newAgent(id: string, role: AgentRole, now: number): AgentRecord {
  return {
    id,
    role,
    agent: null,
    title: null,
    parentId: null,
    runId: null,
    dispatchId: null,
    taskId: null,
    terminalId: null,
    terminalHandle: null,
    paneKey: null,
    sessionId: null,
    workspaceId: null,
    worktreePath: null,
    branch: null,
    model: null,
    effort: null,
    account: null,
    state: 'unknown',
    outcome: null,
    stateSince: null,
    startedAt: null,
    endedAt: null,
    lastSeenAt: now,
    live: false,
    tokens: null,
    messageCount: null,
    failureCount: 0,
    retryOfDispatchId: null,
    callId: null,
    subagentType: null,
    description: null,
    evidence: [],
    version: 0
  }
}

/** Parses Orca timestamps: ISO strings, "YYYY-MM-DD HH:MM:SS" (UTC) or epoch ms. */
export function parseTime(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value !== 'string' || !value || value === 'None') return null
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value) ? value.replace(' ', 'T') + 'Z' : value
  const ms = Date.parse(normalized)
  return Number.isFinite(ms) ? ms : null
}

export function str(value: unknown): string | null {
  return typeof value === 'string' && value !== '' && value !== 'None' ? value : null
}
