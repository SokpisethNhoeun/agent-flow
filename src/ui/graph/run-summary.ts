// Per-run totals from data Orca already reported: time, task progress, tokens and accounts.
// Tokens are summed only where Orca gave a count; `tokensPartial` says some agents had none.
import type { FlowState, TaskState } from '../../shared/model.ts'

export type RunSummary = {
  elapsedMs: number | null
  total: number
  done: number
  failed: number
  running: number
  agents: number
  tokens: number | null
  tokensPartial: boolean
  accounts: string[]
}

const DONE: ReadonlySet<TaskState> = new Set(['DONE', 'MERGED', 'APPROVED'])
const FAILED: ReadonlySet<TaskState> = new Set(['FAILED', 'CANCELLED'])
const RUNNING: ReadonlySet<TaskState> = new Set(['RUNNING', 'REVIEW', 'TESTING', 'RETRYING'])

export function summarizeRun(state: FlowState, runId: string, now: number): RunSummary | null {
  const run = state.runs[runId]
  if (!run) return null
  const tasks = Object.values(state.tasks).filter((t) => t.runId === runId)
  const agents = Object.values(state.agents).filter((a) => a.runId === runId)
  let tokens: number | null = null
  let missing = 0
  const accounts = new Set<string>()
  for (const agent of agents) {
    if (agent.tokens == null) missing++
    else tokens = (tokens ?? 0) + agent.tokens
    const label = agent.account?.label
    if (label) accounts.add(label)
  }
  const end = run.endedAt ?? (run.state === 'active' ? now : null)
  return {
    elapsedMs: run.startedAt != null && end != null ? Math.max(0, end - run.startedAt) : null,
    total: tasks.length || run.taskCount,
    done: tasks.filter((t) => DONE.has(t.state)).length,
    failed: tasks.filter((t) => FAILED.has(t.state)).length,
    running: tasks.filter((t) => RUNNING.has(t.state)).length,
    agents: agents.length,
    tokens,
    tokensPartial: tokens != null && missing > 0,
    accounts: [...accounts].sort()
  }
}

export function formatElapsed(ms: number | null): string | null {
  if (ms == null) return null
  const minutes = Math.floor(ms / 60000)
  if (minutes < 1) return `${Math.max(1, Math.round(ms / 1000))}s`
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  return `${hours}h ${minutes % 60}m`
}
