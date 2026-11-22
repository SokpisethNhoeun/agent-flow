// The single authoritative Agent Flow state. Adapters write observations here; the store keeps
// ordering (seq), drops duplicates, refuses stale observations and batches deltas for the UIs.
import { applyPatch, MAX_TIMELINE, type EntityPatch, type FlowDelta, type FlowEvent, type FlowEventKind, type FlowSnapshot } from '../../shared/events.ts'
import { EMPTY_LABELS, emptyState, type AgentRecord, type FlowState, type TaskRecord } from '../../shared/model.ts'

type Listener = (delta: FlowDelta) => void

export type EventInput = Omit<FlowEvent, 'seq' | 'id'> & { id?: string }

const DEDUPE_LIMIT = 5000
const STATE_KEYS = new Set(['state', 'live', 'outcome', 'stateSince', 'endedAt'])

export class FlowStore {
  private state: FlowState = emptyState()
  private timeline: FlowEvent[] = []
  private pendingPatches = new Map<string, EntityPatch>()
  private pendingEvents: FlowEvent[] = []
  private pendingFromSeq = 0
  private listeners = new Set<Listener>()
  private seenEventIds = new Set<string>()
  /** observedAt of the last accepted state per agent, so an older poll never overwrites a newer event. */
  private agentObservedAt = new Map<string, number>()
  private flushTimer: ReturnType<typeof setTimeout> | null = null
  private eventCounter = 0

  constructor(private readonly flushMs = 250) {}

  get seq(): number {
    return this.state.seq
  }

  read(): Readonly<FlowState> {
    return this.state
  }

  snapshot(): FlowSnapshot {
    this.flushNow()
    return { state: structuredClone(this.state), events: this.timeline.slice(-MAX_TIMELINE) }
  }

  events(): readonly FlowEvent[] {
    return this.timeline
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** Restores a persisted snapshot; live adapters re-confirm everything afterwards. */
  restore(snapshot: FlowSnapshot): void {
    const restored = snapshot.state
    for (const agent of Object.values(restored.agents)) {
      // Nothing restored from disk counts as live until runtime evidence says so again.
      agent.live = false
      if (agent.state === 'working' || agent.state === 'blocked' || agent.state === 'waiting') agent.state = 'unknown'
    }
    this.state = { ...restored, projects: restored.projects ?? {}, labels: { ...EMPTY_LABELS, ...restored.labels }, seq: Math.max(restored.seq, this.state.seq) + 1 }
    this.timeline = snapshot.events.slice(-MAX_TIMELINE)
    for (const event of this.timeline) this.seenEventIds.add(event.id)
    this.emitReset()
  }

  /** Merges an agent observation. `observedAt` orders competing sources. */
  upsertAgent(id: string, observedAt: number, partial: Partial<AgentRecord>, create: () => AgentRecord): AgentRecord {
    const existing = this.state.agents[id]
    const base = existing ?? create()
    const next: AgentRecord = { ...base }
    const touchesState = Object.keys(partial).some((key) => STATE_KEYS.has(key) && partial[key as keyof AgentRecord] !== undefined)
    const lastObserved = this.agentObservedAt.get(id) ?? 0
    // Runtime state is ordered by observation time: an older poll never overwrites a newer event.
    const stale = touchesState && observedAt < lastObserved
    for (const [key, value] of Object.entries(partial) as [keyof AgentRecord, unknown][]) {
      if (value === undefined || key === 'evidence') continue
      if (stale && STATE_KEYS.has(key)) continue
      ;(next as Record<string, unknown>)[key] = value
    }
    if (partial.evidence) next.evidence = [...new Set([...(base.evidence ?? []), ...partial.evidence])]
    next.lastSeenAt = Math.max(base.lastSeenAt ?? 0, observedAt)
    if (touchesState && !stale) this.agentObservedAt.set(id, observedAt)
    if (existing && sameRecord(existing, next)) return existing
    next.version = (base.version ?? 0) + 1
    this.patch({ entity: 'agent', id, value: next })
    return next
  }

  upsertTask(task: TaskRecord): TaskRecord {
    const existing = this.state.tasks[task.id]
    if (existing && sameRecord(existing, { ...task, version: existing.version })) return existing
    const next = { ...task, version: (existing?.version ?? 0) + 1 }
    this.patch({ entity: 'task', id: task.id, value: next })
    return next
  }

  /** Generic upsert for records compared by content. */
  put(patch: EntityPatch): void {
    const current = this.currentValue(patch)
    if (current !== undefined && patch.value !== null && sameRecord(current, patch.value)) return
    if (current === undefined && patch.value === null) return
    this.patch(patch)
  }

  removeAgent(id: string): void {
    if (!this.state.agents[id]) return
    this.agentObservedAt.delete(id)
    this.patch({ entity: 'agent', id, value: null })
  }

  emit(input: EventInput): FlowEvent | null {
    const id = input.id ?? `${input.kind}:${input.entityId}:${input.ts}:${++this.eventCounter}`
    if (this.seenEventIds.has(id)) return null
    this.seenEventIds.add(id)
    if (this.seenEventIds.size > DEDUPE_LIMIT) {
      const first = this.seenEventIds.values().next().value
      if (first !== undefined) this.seenEventIds.delete(first)
    }
    const event: FlowEvent = { ...input, id, seq: this.bumpSeq() }
    this.timeline.push(event)
    if (this.timeline.length > MAX_TIMELINE * 2) this.timeline.splice(0, this.timeline.length - MAX_TIMELINE)
    this.pendingEvents.push(event)
    this.scheduleFlush()
    return event
  }

  hasEvent(kind: FlowEventKind, entityId: string): boolean {
    return this.timeline.some((event) => event.kind === kind && event.entityId === entityId)
  }

  flushNow(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer)
      this.flushTimer = null
    }
    if (this.pendingPatches.size === 0 && this.pendingEvents.length === 0) return
    const delta: FlowDelta = {
      fromSeq: this.pendingFromSeq,
      toSeq: this.state.seq,
      patches: [...this.pendingPatches.values()],
      events: this.pendingEvents
    }
    this.pendingPatches = new Map()
    this.pendingEvents = []
    this.pendingFromSeq = this.state.seq
    for (const listener of this.listeners) {
      try {
        listener(delta)
      } catch {
        // one broken listener must not stop the others
      }
    }
  }

  dispose(): void {
    if (this.flushTimer) clearTimeout(this.flushTimer)
    this.listeners.clear()
  }

  private patch(patch: EntityPatch): void {
    applyPatch(this.state, patch)
    this.bumpSeq()
    this.pendingPatches.set(`${patch.entity}:${patch.id}`, patch)
    this.scheduleFlush()
  }

  private bumpSeq(): number {
    if (this.pendingPatches.size === 0 && this.pendingEvents.length === 0 && !this.flushTimer) this.pendingFromSeq = this.state.seq
    this.state.seq += 1
    this.state.generatedAt = Date.now()
    return this.state.seq
  }

  private scheduleFlush(): void {
    if (this.flushTimer) return
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null
      this.flushNow()
    }, this.flushMs)
  }

  /** Tells every client to re-snapshot (fromSeq that can never match). */
  private emitReset(): void {
    const delta: FlowDelta = { fromSeq: -1, toSeq: this.state.seq, patches: [], events: [] }
    this.pendingFromSeq = this.state.seq
    for (const listener of this.listeners) listener(delta)
  }

  private currentValue(patch: EntityPatch): unknown {
    switch (patch.entity) {
      case 'agent':
        return this.state.agents[patch.id]
      case 'task':
        return this.state.tasks[patch.id]
      case 'run':
        return this.state.runs[patch.id]
      case 'gate':
        return this.state.gates[patch.id]
      case 'worktree':
        return this.state.worktrees[patch.id]
      case 'account':
        return this.state.accounts[patch.id]
      case 'project':
        return this.state.projects?.[patch.id]
      case 'message':
        return this.state.messages.find((message) => message.id === patch.id)
      case 'toolCall':
        return this.state.toolCalls.find((call) => call.id === patch.id)
      case 'capabilities':
        return this.state.capabilities
      case 'labels':
        return this.state.labels
    }
  }
}

function sameRecord(a: unknown, b: unknown): boolean {
  const strip = (value: unknown) => {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const { version: _version, lastSeenAt: _lastSeen, ...rest } = value as Record<string, unknown>
      return rest
    }
    return value
  }
  return JSON.stringify(strip(a)) === JSON.stringify(strip(b))
}
