// Orchestration runs, tasks, dispatched workers, messages and gates from the documented
// `orca orchestration … --json` commands. Polled adaptively; every record keeps its source.
import type { FlowEventKind } from '../../shared/events.ts'
import type { AgentRuntimeState, GateRecord, MessageRecord, RunRecord, TaskRecord, TaskState } from '../../shared/model.ts'
import { redact, redactNullable, truncate } from '../../shared/redact.ts'
import { inferTaskKind, mapOrcaTaskStatus, TERMINAL_TASK_STATES } from '../../shared/task-states.ts'
import { newAgent, parseTime, str, type WorkerContext } from '../context.ts'
import { dedupeAgent, mergeDuplicatesOf } from '../state/merge-agents.ts'

type RawTask = Record<string, unknown> & { id: string }
type RawWorkerRow = { dispatchId: string; taskId: string; state: string; liveness?: string; terminal?: string; workspace?: string; host?: string }
type RawMessage = Record<string, unknown> & { id: string }

const STOPPED_STATES = new Set(['stopped', 'abandoned', 'fenced', 'cancelled'])
const MAX_RUNS = 25
const MAX_DETAIL_PER_CYCLE = 10
const MAX_WORKER_PAGES = 3
/** Live state carries previews only; full text is fetched on demand (panel answers are capped at 1 MiB). */
const SPEC_PREVIEW = 600
/** Result text kept in the shared state; the inspector fetches the rest on demand. */
const RESULT_PREVIEW = 600
const SPEC_LIMIT = 60000
const BODY_PREVIEW = 600
const FULL_TEXT_LIMIT = 1000

export class OrchestrationAdapter {
  private cycle = 0
  private polling = false
  /** dispatchId → last worker-show fingerprint; settled ones are not re-fetched. */
  private detailed = new Map<string, string>()
  private dispatchRows = new Map<string, RawWorkerRow>()
  /** Full task specs and message bodies, kept out of the shared state. */
  private fullText = new Map<string, string>()
  private runDetailCheckedAt = new Map<string, number>()

  constructor(private readonly ctx: WorkerContext) {}

  /** Full spec / body for the inspector; null when not known. */
  fullTextFor(key: string): string | null {
    return this.fullText.get(key) ?? null
  }

  private keepFull(key: string, text: string, preview: number): string {
    this.fullText.set(key, text)
    if (this.fullText.size > FULL_TEXT_LIMIT) {
      const oldest = this.fullText.keys().next().value
      if (oldest !== undefined) this.fullText.delete(oldest)
    }
    return truncate(text, preview)
  }

  get hasActiveWork(): boolean {
    const state = this.ctx.store.read()
    // Only orchestration work speeds up orchestration polling; live chat agents do not need it.
    return Object.values(state.runs).some((run) => run.state === 'active' && Object.values(state.agents).some((a) => a.runId === run.id && a.live))
  }

  async poll(): Promise<void> {
    if (this.polling || !this.ctx.cli.path) return
    this.polling = true
    this.cycle++
    try {
      const runs = await this.pollRuns()
      if (!runs) return
      for (const run of runs) {
        const full = run.state === 'active' || this.cycle % 6 === 1
        if (full) await this.pollTasks(run.id)
        // Chat-coordinated runs never get a handle: look once, then rarely.
        const lastCheck = this.runDetailCheckedAt.get(run.id)
        if (!run.coordinatorHandle && (lastCheck === undefined || this.cycle - lastCheck >= 60)) {
          this.runDetailCheckedAt.set(run.id, this.cycle)
          await this.pollRunDetail(run.id)
        }
      }
      await this.pollWorkers()
      await this.pollMessages()
      this.refreshRunStates()
      // Use the state computed from this cycle's tasks, so gates show up on the first poll too.
      const active = Object.values(this.ctx.store.read().runs).filter((run) => run.state === 'active')
      for (const run of active) await this.pollGates(run.id)
      if (active.length) this.refreshRunStates()
    } catch (error) {
      this.ctx.log(`orchestration poll failed: ${(error as Error).message}`)
    } finally {
      this.polling = false
    }
  }

  private async pollRuns(): Promise<RunRecord[] | null> {
    const result = await this.ctx.cli.run<{ runs: { id: string; objective?: string; legacy?: boolean }[] }>(['orchestration', 'run-list'])
    if (!result.ok) {
      this.ctx.log(`run-list: ${result.code} ${result.message}`)
      return null
    }
    const out: RunRecord[] = []
    for (const raw of result.result.runs.filter((run) => !run.legacy).slice(0, MAX_RUNS)) {
      const previous = this.ctx.store.read().runs[raw.id]
      const record: RunRecord = previous
        ? { ...previous, objective: raw.objective ?? previous.objective }
        : { id: raw.id, objective: raw.objective ?? raw.id, legacy: false, coordinatorHandle: null, state: 'idle', startedAt: null, endedAt: null, taskCount: 0, version: 0 }
      this.ctx.store.put({ entity: 'run', id: raw.id, value: record })
      this.ensureLead(record)
      if (!previous) this.ctx.store.emit({ id: `run:${raw.id}`, ts: this.ctx.now(), kind: 'orchestration.started', source: 'cli-poll', entityId: raw.id, runId: raw.id, summary: `Run: ${truncate(record.objective, 120)}` })
      out.push(this.ctx.store.read().runs[raw.id])
    }
    return out
  }

  /** run-show --full names the coordinator's terminal handle (null for chat coordinators) and creation time. */
  private async pollRunDetail(runId: string): Promise<void> {
    const result = await this.ctx.cli.run<{ run?: Record<string, unknown> }>(['orchestration', 'run-show', '--id', runId, '--full'])
    if (!result.ok || !result.result.run) return
    const raw = result.result.run
    const run = this.ctx.store.read().runs[runId]
    if (!run) return
    const coordinatorHandle = str(raw.coordinator_handle) ?? run.coordinatorHandle
    const startedAt = run.startedAt ?? parseTime(raw.created_at)
    if (coordinatorHandle === run.coordinatorHandle && startedAt === run.startedAt) return
    const next = { ...run, coordinatorHandle, startedAt }
    this.ctx.store.put({ entity: 'run', id: runId, value: next })
    this.ensureLead(next)
  }

  /** The coordinator of a run. Structural (every run has one); live only with runtime evidence. */
  private ensureLead(run: RunRecord): void {
    const id = `lead:${run.id}`
    const now = this.ctx.now()
    this.ctx.store.upsertAgent(
      id,
      0,
      { role: 'lead', runId: run.id, title: 'Lead orchestrator', description: truncate(run.objective, 200), terminalHandle: run.coordinatorHandle ?? undefined, evidence: ['cli-poll'] },
      () => newAgent(id, 'lead', now)
    )
    if (run.coordinatorHandle) this.ctx.identity.link(id, { terminalHandle: run.coordinatorHandle })
  }

  private async pollTasks(runId: string): Promise<void> {
    const result = await this.ctx.cli.run<{ tasks: RawTask[] }>(['orchestration', 'task-list', '--run', runId, '--full'])
    if (!result.ok) {
      this.ctx.log(`task-list ${runId}: ${result.code} ${result.message}`)
      return
    }
    let coordinator: string | null = null
    for (const raw of result.result.tasks) {
      coordinator ??= str(raw.created_by_terminal_handle)
      this.applyTask(runId, raw)
    }
    const run = this.ctx.store.read().runs[runId]
    if (run) {
      const tasks = result.result.tasks
      const times = tasks.map((task) => parseTime(task.created_at)).filter((t): t is number => t !== null)
      this.ctx.store.put({
        entity: 'run',
        id: runId,
        value: { ...run, taskCount: tasks.length, coordinatorHandle: run.coordinatorHandle ?? coordinator, startedAt: times.length ? Math.min(...times) : run.startedAt }
      })
      if (coordinator && !run.coordinatorHandle) this.ensureLead({ ...run, coordinatorHandle: coordinator })
    }
  }

  private applyTask(runId: string, raw: RawTask): void {
    const state = this.ctx.store.read()
    const previous = state.tasks[raw.id]
    const title = str(raw.task_title) ?? str(raw.display_name) ?? raw.id
    const kind = inferTaskKind(`${title} ${str(raw.display_name) ?? ''}`)
    const parsedResult = parseResult(raw.result)
    // Keep the shared state small (it is sent to every view): long result text stays here.
    const result = parsedResult?.message ? { ...parsedResult, message: this.keepFull(`result:${raw.id}`, parsedResult.message, RESULT_PREVIEW) } : parsedResult
    const dispatchIds = previous?.dispatchIds ?? []
    const latestDispatch = dispatchIds.length ? this.dispatchRows.get(dispatchIds[dispatchIds.length - 1]) : undefined
    const gateIds = Object.values(state.gates).filter((gate) => gate.taskId === raw.id).map((gate) => gate.id)
    const hasOpenGate = gateIds.some((id) => state.gates[id]?.status === 'pending')
    const taskState = mapOrcaTaskStatus({
      orcaStatus: str(raw.status) ?? 'pending',
      kind,
      resultOutcome: result?.outcome ?? null,
      hasOpenGate,
      retryCount: Math.max(0, dispatchIds.length - 1),
      dispatchActive: latestDispatch ? isLiveWorker(latestDispatch) : false
    })
    const record: TaskRecord = {
      id: raw.id,
      runId,
      parentId: str(raw.parent_id),
      title: redact(title),
      displayName: redactNullable(str(raw.display_name)),
      spec: raw.spec ? this.keepFull(`task:${raw.id}`, redact(truncate(String(raw.spec), SPEC_LIMIT)), SPEC_PREVIEW) : null,
      kind,
      orcaStatus: str(raw.status) ?? 'pending',
      state: taskState,
      deps: parseDeps(raw.deps),
      assigneeAgentId: previous?.assigneeAgentId ?? null,
      dispatchIds,
      result,
      createdAt: parseTime(raw.created_at),
      completedAt: parseTime(raw.completed_at),
      retryCount: Math.max(0, dispatchIds.length - 1),
      gateIds,
      version: previous?.version ?? 0
    }
    this.ctx.store.upsertTask(record)
    if (!previous) {
      this.ctx.store.emit({ id: `task.created:${raw.id}`, ts: record.createdAt ?? this.ctx.now(), kind: 'task.created', source: 'cli-poll', entityId: raw.id, runId, summary: `Task created: ${truncate(record.title, 100)}` })
    } else if (previous.state !== record.state) {
      this.ctx.store.emit({ ts: this.ctx.now(), kind: taskEventKind(record.state, record.kind), source: 'cli-poll', entityId: raw.id, runId, targetId: record.assigneeAgentId, summary: `${truncate(record.title, 80)}: ${previous.state} → ${record.state}` })
    }
  }

  private async pollWorkers(): Promise<void> {
    const rows: RawWorkerRow[] = []
    let cursor: string | null = null
    for (let page = 0; page < MAX_WORKER_PAGES; page++) {
      const args = ['orchestration', 'worker-list']
      if (cursor) args.push('--cursor', cursor)
      const result: Awaited<ReturnType<typeof this.ctx.cli.run<{ workers: RawWorkerRow[]; nextCursor?: string | null }>>> = await this.ctx.cli.run(args)
      if (!result.ok) {
        this.ctx.log(`worker-list: ${result.code} ${result.message}`)
        break
      }
      rows.push(...result.result.workers)
      cursor = result.result.nextCursor ?? null
      if (!cursor) break
    }
    const tasks = this.ctx.store.read().tasks
    let detailBudget = MAX_DETAIL_PER_CYCLE
    const known = rows.filter((row) => tasks[row.taskId])
    // Apply in Orca's order, so a task's dispatch history (retries) stays chronological.
    for (const row of known) {
      this.dispatchRows.set(row.dispatchId, row)
      this.applyWorkerRow(row)
    }
    // Details (agent, model, effort, pane) for live and failed workers first, then the rest.
    const priority = (row: RawWorkerRow) => (isLiveWorker(row) ? 0 : mapWorkerState(row) === 'failed' ? 1 : 2)
    for (const row of [...known].sort((a, b) => priority(a) - priority(b))) {
      if (detailBudget <= 0) break
      const fingerprint = `${row.state}|${row.liveness ?? ''}|${row.terminal ?? ''}`
      if (this.detailed.get(row.dispatchId) === fingerprint && !isLiveWorker(row)) continue
      detailBudget--
      await this.pollWorkerDetail(row.dispatchId)
      this.detailed.set(row.dispatchId, fingerprint)
    }
  }

  private applyWorkerRow(row: RawWorkerRow): void {
    const id = `dispatch:${row.dispatchId}`
    const now = this.ctx.now()
    const task = this.ctx.store.read().tasks[row.taskId]
    const previous = this.ctx.store.read().agents[id]
    const [projectId, worktreePath] = splitWorkspace(row.workspace)
    const polled = mapWorkerState(row)
    // Host status events are the precise live signal; a durable poll only overrides them to settle.
    const hostDriven = previous?.evidence.includes('host-event') && polled !== 'done' && polled !== 'failed'
    const state = hostDriven ? previous.state : polled
    const record = this.ctx.store.upsertAgent(
      id,
      now,
      {
        role: 'worker',
        dispatchId: row.dispatchId,
        taskId: row.taskId,
        runId: task?.runId ?? undefined,
        parentId: previous?.parentId ?? (task ? `lead:${task.runId}` : null),
        terminalHandle: row.terminal ?? undefined,
        workspaceId: row.workspace ?? undefined,
        worktreePath: worktreePath ?? undefined,
        projectId: projectId ?? undefined,
        branch: Object.values(this.ctx.store.read().worktrees).find((w) => w.path === worktreePath)?.branch ?? undefined,
        title: previous?.title ?? task?.displayName ?? task?.title ?? 'Worker',
        state,
        live: hostDriven ? previous.live : isLiveWorker(row),
        // A stopped/abandoned worker ended by request, not by finishing its task.
        outcome: STOPPED_STATES.has(row.state.toLowerCase()) ? 'cancellation' : undefined,
        evidence: ['cli-poll']
      },
      () => newAgent(id, 'worker', now)
    )
    this.ctx.identity.link(id, { terminalHandle: row.terminal ?? null })
    if (task && !task.dispatchIds.includes(row.dispatchId)) {
      const dispatchIds = [...task.dispatchIds, row.dispatchId]
      this.ctx.store.upsertTask({ ...task, dispatchIds, assigneeAgentId: id, retryCount: Math.max(0, dispatchIds.length - 1) })
      this.ctx.store.emit({ id: `task.assigned:${row.dispatchId}`, ts: now, kind: dispatchIds.length > 1 ? 'task.retried' : 'task.assigned', source: 'cli-poll', entityId: row.taskId, targetId: id, runId: task.runId, summary: `${truncate(task.title, 80)} → ${record.title}` })
    }
    if (previous && previous.state !== record.state) {
      this.ctx.store.emit({ ts: now, kind: state === 'failed' ? 'agent.failed' : state === 'done' ? 'agent.completed' : 'agent.status_changed', source: 'cli-poll', entityId: id, runId: record.runId, summary: `${record.title}: ${previous.state} → ${state}` })
    }
  }

  private async pollWorkerDetail(dispatchId: string): Promise<void> {
    const result = await this.ctx.cli.run<Record<string, unknown>>(['orchestration', 'worker-show', '--dispatch', dispatchId, '--full'])
    if (!result.ok) return
    const detail = result.result
    const dispatch = asRecord(detail.dispatch)
    const worker = asRecord(detail.worker)
    const start = asRecord(worker.startOptions)
    const launch = asRecord(asRecord(start.launch).effective)
    const requested = asRecord(asRecord(start.launch).requested)
    const id = `dispatch:${dispatchId}`
    const creator = str(dispatch.creatorDispatchId)
    const task = this.ctx.store.read().tasks[str(dispatch.taskId) ?? '']
    const record = this.ctx.store.upsertAgent(
      id,
      this.ctx.now(),
      {
        agent: str(launch.agent) ?? str(start.agent) ?? undefined,
        model: str(launch.model) ?? str(requested.model) ?? undefined,
        effort: str(launch.effort) ?? str(requested.effort) ?? undefined,
        paneKey: str(dispatch.assigneePaneKey) ?? undefined,
        terminalHandle: str(dispatch.assigneeHandle) ?? undefined,
        parentId: creator ? `dispatch:${creator}` : task ? `lead:${task.runId}` : undefined,
        retryOfDispatchId: str(dispatch.retryOfDispatchId),
        failureCount: typeof dispatch.failureCount === 'number' ? dispatch.failureCount : 0,
        startedAt: parseTime(dispatch.dispatchedAt) ?? undefined,
        endedAt: parseTime(dispatch.completedAt),
        outcome: str(asRecord(detail.projection).outcome) ?? undefined,
        evidence: ['cli-poll']
      },
      () => newAgent(id, 'worker', this.ctx.now())
    )
    this.ctx.identity.link(id, { paneKey: record.paneKey, terminalHandle: record.terminalHandle })
    // Status events may have created a record for this session before Orca named the dispatch.
    mergeDuplicatesOf(this.ctx.store, this.ctx.identity, id)
    dedupeAgent(this.ctx.store, this.ctx.identity, id)
    this.orderDispatches(record.taskId)
    if (str(dispatch.retryOfDispatchId)) {
      this.ctx.store.emit({ id: `retry:${dispatchId}`, ts: record.startedAt ?? this.ctx.now(), kind: 'task.retried', source: 'cli-poll', entityId: record.taskId ?? id, targetId: id, runId: record.runId, summary: `Retry of ${str(dispatch.retryOfDispatchId)} started` })
    }
  }

  /** Keeps a task's attempts in start order once start times are known; the last is the latest. */
  private orderDispatches(taskId: string | null): void {
    const task = taskId ? this.ctx.store.read().tasks[taskId] : undefined
    if (!task || task.dispatchIds.length < 2) return
    const agents = this.ctx.store.read().agents
    const info = (id: string) => agents[`dispatch:${id}`]
    // Reorder only with full information; otherwise keep Orca's order.
    if (task.dispatchIds.some((id) => info(id)?.startedAt == null)) return
    const sorted = [...task.dispatchIds].sort((a, b) => {
      if (info(b)?.retryOfDispatchId === a) return -1
      if (info(a)?.retryOfDispatchId === b) return 1
      return (info(a)!.startedAt as number) - (info(b)!.startedAt as number)
    })
    if (sorted.join() === task.dispatchIds.join()) return
    this.ctx.store.upsertTask({ ...task, dispatchIds: sorted, assigneeAgentId: `dispatch:${sorted[sorted.length - 1]}` })
  }

  private async pollMessages(): Promise<void> {
    const result = await this.ctx.cli.run<{ messages: RawMessage[] }>(['orchestration', 'inbox', '--limit', '150', '--full'])
    if (!result.ok) return
    const known = new Set(this.ctx.store.read().messages.map((message) => message.id))
    for (const raw of [...result.result.messages].reverse()) {
      if (known.has(raw.id)) continue
      const payload = parseJson(raw.payload)
      const fromHandle = str(raw.from_handle)
      const toHandle = str(raw.to_handle)
      const fromAgentId = this.ctx.identity.resolve({ terminalHandle: fromHandle, paneKey: str(raw.sender_pane_key) }) ?? leadFor(fromHandle)
      const toAgentId = this.ctx.identity.resolve({ terminalHandle: toHandle }) ?? leadFor(toHandle)
      const message: MessageRecord = {
        id: raw.id,
        runId: str(raw.run_id),
        fromHandle,
        toHandle,
        fromAgentId,
        toAgentId,
        type: str(raw.type) ?? 'message',
        subject: redactNullable(str(raw.subject)),
        body: raw.body ? this.keepFull(`message:${raw.id}`, redact(truncate(String(raw.body), SPEC_LIMIT)), BODY_PREVIEW) : null,
        taskId: str(payload.taskId),
        createdAt: parseTime(raw.created_at) ?? this.ctx.now()
      }
      this.ctx.store.put({ entity: 'message', id: raw.id, value: message })
      this.ctx.store.emit({
        id: `message:${raw.id}`,
        ts: message.createdAt,
        kind: 'message.sent',
        source: 'cli-poll',
        entityId: fromAgentId ?? fromHandle ?? 'unknown',
        targetId: toAgentId,
        runId: message.runId,
        summary: `${message.type}: ${truncate(message.subject ?? message.body ?? '', 120)}`
      })
    }
  }

  private async pollGates(runId: string): Promise<void> {
    const result = await this.ctx.cli.run<{ gates?: Record<string, unknown>[] }>(['orchestration', 'gate-list', '--run', runId, '--full'])
    if (!result.ok) return
    for (const raw of result.result.gates ?? []) {
      const id = str(raw.id)
      if (!id) continue
      const gate: GateRecord = {
        id,
        taskId: str(raw.task_id) ?? str(raw.taskId),
        question: redactNullable(str(raw.question) ?? str(raw.prompt)),
        status: str(raw.status) ?? 'pending',
        resolution: redactNullable(str(raw.resolution)),
        createdAt: parseTime(raw.created_at ?? raw.createdAt)
      }
      const previous = this.ctx.store.read().gates[id]
      this.ctx.store.put({ entity: 'gate', id, value: gate })
      if (!previous && gate.status === 'pending' && gate.taskId) {
        this.ctx.store.emit({ id: `gate:${id}`, ts: gate.createdAt ?? this.ctx.now(), kind: 'task.blocked', source: 'cli-poll', entityId: gate.taskId, runId, summary: `Decision gate: ${truncate(gate.question ?? id, 100)}` })
      }
    }
  }

  private refreshRunStates(): void {
    const state = this.ctx.store.read()
    for (const run of Object.values(state.runs)) {
      const tasks = Object.values(state.tasks).filter((task) => task.runId === run.id)
      if (!tasks.length) continue
      const allDone = tasks.every((task) => TERMINAL_TASK_STATES.includes(task.state))
      const anyFailed = tasks.some((task) => task.state === 'FAILED')
      const next: RunRecord['state'] = allDone ? (anyFailed ? 'failed' : 'completed') : 'active'
      const endedAt = allDone ? Math.max(...tasks.map((task) => task.completedAt ?? 0)) || null : null
      if (next !== run.state || endedAt !== run.endedAt) {
        this.ctx.store.put({ entity: 'run', id: run.id, value: { ...run, state: next, endedAt } })
        if (allDone && run.state === 'active') {
          this.ctx.store.emit({ id: `run.done:${run.id}`, ts: endedAt ?? this.ctx.now(), kind: 'orchestration.completed', source: 'cli-poll', entityId: run.id, runId: run.id, summary: `Run ${next}: ${truncate(run.objective, 100)}` })
        }
      }
    }
  }
}

export function mapWorkerState(row: { state: string; liveness?: string }): AgentRuntimeState {
  const state = row.state.toLowerCase()
  if (state === 'succeeded' || state === 'completed' || state === 'settled') return 'done'
  if (state === 'failed' || state === 'outcome_unknown') return 'failed'
  if (state === 'stopped' || state === 'abandoned' || state === 'fenced' || state === 'cancelled') return 'done'
  if (state === 'blocked' || state === 'permission') return 'blocked'
  if (state === 'ready') return isLiveWorker(row) ? 'waiting' : 'idle'
  if (state === 'starting' || state === 'running' || state === 'working' || state === 'dispatched') return 'working'
  return 'unknown'
}

export function isLiveWorker(row: { state: string; liveness?: string }): boolean {
  const liveness = (row.liveness ?? '').toLowerCase()
  if (liveness === 'exited' || liveness === 'stopped') return false
  if (liveness === 'alive' || liveness === 'running' || liveness === 'live') return true
  const state = row.state.toLowerCase()
  return liveness !== 'unverifiable' && (state === 'starting' || state === 'running' || state === 'working')
}

function taskEventKind(state: TaskState, kind: string): FlowEventKind {
  switch (state) {
    case 'RUNNING':
      return 'task.started'
    case 'REVIEW':
      return 'review.started'
    case 'TESTING':
      return 'test.started'
    case 'DONE':
    case 'MERGED':
    case 'APPROVED':
      return kind === 'review' ? 'review.completed' : kind === 'test' ? 'test.completed' : 'task.completed'
    case 'FAILED':
      return 'task.failed'
    case 'BLOCKED':
      return 'task.blocked'
    case 'RETRYING':
      return 'task.retried'
    default:
      return 'task.updated'
  }
}

function parseResult(value: unknown): TaskRecord['result'] {
  if (value == null || value === '') return null
  const parsed = parseJson(value)
  if (!Object.keys(parsed).length) {
    // Orca's documented cancel is `--status failed --result cancelled`: a plain-text result.
    const text = String(value).trim()
    const outcome = /^(cancel(l)?ed|cancellation)$/i.test(text) ? 'cancelled' : null
    return { outcome, message: redact(truncate(text, 4000)), filesModified: [], raw: null }
  }
  const files = Array.isArray(parsed.filesModified) ? parsed.filesModified.filter((f): f is string => typeof f === 'string').slice(0, 200) : []
  return {
    outcome: str(parsed.outcome),
    message: parsed.message ? redact(truncate(String(parsed.message), 4000)) : null,
    filesModified: files,
    // The raw JSON is never shown; leaving it out keeps snapshots and deltas small.
    raw: null
  }
}

function parseDeps(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === 'string')
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value)
      return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : []
    } catch {
      return value.split(',').map((s) => s.trim()).filter(Boolean)
    }
  }
  return []
}

function parseJson(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>
  if (typeof value !== 'string') return {}
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function splitWorkspace(value: string | undefined): [string | null, string | null] {
  if (!value) return [null, null]
  const index = value.indexOf('::')
  return index >= 0 ? [value.slice(0, index), value.slice(index + 2)] : [null, value]
}

function leadFor(handle: string | null): string | null {
  return handle?.startsWith('run:') ? `lead:${handle.slice(4)}` : null
}
