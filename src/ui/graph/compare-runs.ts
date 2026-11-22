// Side-by-side comparison of two saved runs. Tasks are matched by their name (display name or
// title, case- and space-insensitive); each row says what changed between the two runs.
import type { AgentRecord, RunRecord, TaskRecord, TaskState } from '../../shared/model.ts'

export type ComparableRun = { run: RunRecord; tasks: TaskRecord[]; agents: AgentRecord[]; savedAt?: number }

export type RowChange = 'added' | 'removed' | 'fixed' | 'broke' | 'slower' | 'faster' | 'changed' | 'same'

export type CompareRow = {
  name: string
  a: { state: TaskState; durationMs: number | null; retries: number } | null
  b: { state: TaskState; durationMs: number | null; retries: number } | null
  change: RowChange
}

/** `ongoing`: the run was still active when saved, so the time is "so far". */
export type RunTotals = { tasks: number; done: number; failed: number; durationMs: number | null; ongoing: boolean; tokens: number | null }

const OK: ReadonlySet<TaskState> = new Set(['DONE', 'MERGED', 'APPROVED'])
const BAD: ReadonlySet<TaskState> = new Set(['FAILED', 'CANCELLED', 'BLOCKED'])
/** Duration differences under this share (or under 30 s) count as the same. */
const SPEED_THRESHOLD = 0.25

const keyOf = (task: TaskRecord) => (task.displayName ?? task.title).trim().toLowerCase().replace(/\s+/g, ' ')

function duration(task: TaskRecord): number | null {
  return task.createdAt != null && task.completedAt != null ? Math.max(0, task.completedAt - task.createdAt) : null
}

function side(task: TaskRecord | undefined) {
  return task ? { state: task.state, durationMs: duration(task), retries: task.retryCount } : null
}

function changeOf(a: CompareRow['a'], b: CompareRow['b']): RowChange {
  if (!a) return 'added'
  if (!b) return 'removed'
  if (BAD.has(a.state) && OK.has(b.state)) return 'fixed'
  if (OK.has(a.state) && BAD.has(b.state)) return 'broke'
  if (a.state !== b.state) return 'changed'
  if (a.durationMs != null && b.durationMs != null) {
    const diff = b.durationMs - a.durationMs
    if (Math.abs(diff) >= 30_000 && Math.abs(diff) / Math.max(a.durationMs, 1) >= SPEED_THRESHOLD) return diff > 0 ? 'slower' : 'faster'
  }
  return 'same'
}

export function compareRuns(a: ComparableRun, b: ComparableRun): CompareRow[] {
  const byKey = (tasks: TaskRecord[]) => {
    const map = new Map<string, TaskRecord>()
    // Same name twice in one run (rare): keep the latest attempt.
    for (const task of [...tasks].sort((x, y) => (x.createdAt ?? 0) - (y.createdAt ?? 0))) map.set(keyOf(task), task)
    return map
  }
  const left = byKey(a.tasks)
  const right = byKey(b.tasks)
  const names = [...new Set([...left.keys(), ...right.keys()])]
  const rows = names.map((key) => {
    const ta = left.get(key)
    const tb = right.get(key)
    const sa = side(ta)
    const sb = side(tb)
    return { name: (tb ?? ta)!.displayName ?? (tb ?? ta)!.title, a: sa, b: sb, change: changeOf(sa, sb) }
  })
  const order: Record<RowChange, number> = { broke: 0, fixed: 1, changed: 2, slower: 3, faster: 4, added: 5, removed: 6, same: 7 }
  return rows.sort((x, y) => order[x.change] - order[y.change] || x.name.localeCompare(y.name))
}

export function runTotals(record: ComparableRun): RunTotals {
  const { run, tasks, agents } = record
  const known = agents.filter((agent) => agent.tokens != null)
  const ongoing = run.state === 'active' && run.endedAt == null
  const end = run.endedAt ?? (ongoing ? (record.savedAt ?? null) : null)
  return {
    tasks: tasks.length,
    done: tasks.filter((t) => OK.has(t.state)).length,
    failed: tasks.filter((t) => BAD.has(t.state)).length,
    durationMs: run.startedAt != null && end != null ? Math.max(0, end - run.startedAt) : null,
    ongoing,
    tokens: known.length ? known.reduce((sum, agent) => sum + (agent.tokens ?? 0), 0) : null
  }
}
