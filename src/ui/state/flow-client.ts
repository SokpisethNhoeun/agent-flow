// Client copy of the worker's state. Applies ordered deltas; on any gap it re-snapshots.
// In replay mode it shows a saved run instead and ignores live deltas (nothing is executed).
import { applyPatch, MAX_TIMELINE, type FlowDelta, type FlowEvent } from '../../shared/events.ts'
import { emptyState, type FlowState } from '../../shared/model.ts'
import type { ConnectionStatus, Transport } from '../transport/types.ts'
import { startViewerPing } from './viewer-ping.ts'

export type ReplayRecord = {
  run: FlowState['runs'][string]
  tasks: FlowState['tasks'][string][]
  agents: FlowState['agents'][string][]
  messages: FlowState['messages']
  events: FlowEvent[]
  savedAt: number
}

export type ClientView = {
  state: FlowState
  events: FlowEvent[]
  status: ConnectionStatus
  error: string | null
  mode: 'live' | 'replay'
  replay: { runId: string; cursor: number; total: number; savedAt: number } | null
  /** True once the first snapshot arrived; before that nothing is shown as live or missing. */
  loaded: boolean
  /** Bumped on every change so React selectors re-run. */
  revision: number
}

export class FlowClient {
  private live: { state: FlowState; events: FlowEvent[] } = { state: emptyState(), events: [] }
  private view: ClientView = { state: emptyState(), events: [], status: 'connecting', error: null, mode: 'live', replay: null, loaded: false, revision: 0 }
  private listeners = new Set<() => void>()
  private unsubscribe: (() => void) | null = null
  private resyncing = false
  /** A resync was asked for while one was running: run another when it ends (no delta is lost). */
  private resyncAgain = false
  private replayRecord: ReplayRecord | null = null
  private outputListeners = new Set<(agentId: string) => void>()

  constructor(readonly transport: Transport) {}

  start(): void {
    const stopPing = startViewerPing(this.transport)
    const unsubscribe = this.transport.subscribe({
      delta: (delta) => this.onDelta(delta),
      resync: () => void this.resync(),
      output: (agentId) => this.outputListeners.forEach((listener) => listener(agentId)),
      status: (status) => this.update({ status: status === 'live' && !this.view.loaded ? 'connecting' : status })
    })
    this.unsubscribe = () => {
      unsubscribe()
      stopPing()
    }
    void this.resync()
  }

  stop(): void {
    this.unsubscribe?.()
  }

  getView = (): ClientView => this.view

  /** Live output notices from the worker (an agent's conversation changed). */
  onOutput = (listener: (agentId: string) => void): (() => void) => {
    this.outputListeners.add(listener)
    return () => this.outputListeners.delete(listener)
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  async resync(): Promise<void> {
    if (this.resyncing) {
      this.resyncAgain = true
      return
    }
    this.resyncing = true
    this.resyncAgain = false
    try {
      const snapshot = await this.transport.snapshot()
      this.live = { state: snapshot.state, events: snapshot.events }
      if (this.view.mode === 'live') this.update({ state: snapshot.state, events: snapshot.events, error: null, status: 'live', loaded: true })
      else this.update({ status: 'live', loaded: true })
    } catch (error) {
      this.update({ error: (error as Error).message, status: 'offline' })
      setTimeout(() => void this.resync(), 3000)
    } finally {
      this.resyncing = false
      if (this.resyncAgain) void this.resync()
    }
  }

  /** Shows a saved run. Live updates keep arriving in the background but are not shown. */
  enterReplay(record: ReplayRecord): void {
    this.replayRecord = record
    const events = [...record.events].sort((a, b) => a.ts - b.ts)
    this.update({ mode: 'replay', replay: { runId: record.run.id, cursor: events.length, total: events.length, savedAt: record.savedAt }, ...this.replayFrame(events.length) })
  }

  /** Moves the replay to the state as of event `cursor` (0…total). Purely visual. */
  seekReplay(cursor: number): void {
    if (!this.replayRecord || !this.view.replay) return
    const clamped = Math.max(0, Math.min(cursor, this.view.replay.total))
    this.update({ replay: { ...this.view.replay, cursor: clamped }, ...this.replayFrame(clamped) })
  }

  exitReplay(): void {
    this.replayRecord = null
    this.update({ mode: 'live', replay: null, state: this.live.state, events: this.live.events })
  }

  private replayFrame(cursor: number): { state: FlowState; events: FlowEvent[] } {
    const record = this.replayRecord!
    const events = [...record.events].sort((a, b) => a.ts - b.ts)
    const shown = events.slice(0, cursor)
    const until = shown.length ? shown[shown.length - 1].ts : record.run.startedAt ?? 0
    const atEnd = cursor >= events.length
    const state = emptyState()
    state.capabilities = this.live.state.capabilities
    state.labels = this.live.state.labels
    state.accounts = this.live.state.accounts
    state.projects = this.live.state.projects ?? {}
    state.runs[record.run.id] = record.run
    const seen = new Set(shown.map((event) => event.entityId))
    for (const task of record.tasks) {
      if (!atEnd && task.createdAt && task.createdAt > until) continue
      state.tasks[task.id] = atEnd ? task : { ...task, state: seen.has(task.id) || (task.createdAt ?? 0) <= until ? task.state : 'PENDING' }
    }
    for (const agent of record.agents) {
      if (!atEnd && agent.startedAt && agent.startedAt > until) continue
      // Replay never shows anything as live.
      state.agents[agent.id] = { ...agent, live: false }
    }
    state.messages = record.messages.filter((message) => atEnd || message.createdAt <= until)
    return { state, events: shown }
  }

  private onDelta(delta: FlowDelta): void {
    const current = this.live.state
    if (delta.fromSeq !== current.seq) {
      void this.resync()
      return
    }
    const next: FlowState = {
      ...current,
      agents: { ...current.agents },
      tasks: { ...current.tasks },
      runs: { ...current.runs },
      gates: { ...current.gates },
      worktrees: { ...current.worktrees },
      accounts: { ...current.accounts },
      projects: { ...(current.projects ?? {}) },
      messages: [...current.messages],
      toolCalls: [...current.toolCalls]
    }
    for (const patch of delta.patches) applyPatch(next, patch)
    next.seq = delta.toSeq
    const events = delta.events.length ? [...this.live.events, ...delta.events].slice(-MAX_TIMELINE) : this.live.events
    this.live = { state: next, events }
    if (this.view.mode === 'live') this.update({ state: next, events })
  }

  private update(partial: Partial<ClientView>): void {
    this.view = { ...this.view, ...partial, revision: this.view.revision + 1 }
    for (const listener of this.listeners) listener()
  }
}
