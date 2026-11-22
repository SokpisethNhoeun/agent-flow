// Live output: watches the transcript file of each conversation someone has open and says when
// it changes, so views fetch right away instead of polling. Only files a view read recently are
// watched, a few at most, and a watch ends by itself once nobody has read it for a minute.
import { watch, type FSWatcher } from 'node:fs'

type Watch = { path: string; watcher: FSWatcher; lastRead: number; timer: ReturnType<typeof setTimeout> | null }

export type WatchFactory = (path: string, onChange: () => void) => FSWatcher

const nodeWatch: WatchFactory = (path, onChange) => watch(path, { persistent: false }, onChange)

export class OutputWatcher {
  private watches = new Map<string, Watch>()
  private listeners = new Set<(agentId: string) => void>()
  /** Agents without a transcript file (terminal output): when a view last read them. */
  private interested = new Map<string, { lastRead: number; timer: ReturnType<typeof setTimeout> | null }>()

  constructor(
    private readonly options: { now?: () => number; idleMs?: number; max?: number; debounceMs?: number; watchFile?: WatchFactory } = {}
  ) {}

  private get now() {
    return this.options.now ?? Date.now
  }

  /** A view read this agent's transcript. Returns true when changes will be pushed. */
  track(agentId: string, path: string): boolean {
    const now = this.now()
    this.sweep(now)
    const existing = this.watches.get(agentId)
    if (existing && existing.path === path) {
      existing.lastRead = now
      return true
    }
    if (existing) this.untrack(agentId)
    const max = this.options.max ?? 8
    while (this.watches.size >= max) {
      const oldest = [...this.watches.entries()].sort((a, b) => a[1].lastRead - b[1].lastRead)[0]
      this.untrack(oldest[0])
    }
    let watcher: FSWatcher
    try {
      watcher = (this.options.watchFile ?? nodeWatch)(path, () => this.changed(agentId))
    } catch {
      return false
    }
    watcher.on?.('error', () => this.untrack(agentId))
    this.watches.set(agentId, { path, watcher, lastRead: now, timer: null })
    return true
  }

  /** A view read output that has no file to watch (a terminal); events can still announce changes. */
  noteInterest(agentId: string): void {
    const entry = this.interested.get(agentId)
    if (entry) entry.lastRead = this.now()
    else this.interested.set(agentId, { lastRead: this.now(), timer: null })
    if (this.interested.size > (this.options.max ?? 8) * 4) {
      const oldest = [...this.interested.entries()].sort((a, b) => a[1].lastRead - b[1].lastRead)[0]
      this.dropInterest(oldest[0])
    }
  }

  /** Something happened to this agent (status change, tool call): tell views showing it. */
  poke(agentId: string): void {
    const entry = this.interested.get(agentId)
    if (!entry) return
    if (this.now() - entry.lastRead > (this.options.idleMs ?? 60_000)) {
      this.dropInterest(agentId)
      return
    }
    if (entry.timer) return
    entry.timer = setTimeout(() => {
      entry.timer = null
      if (!this.interested.has(agentId)) return
      for (const listener of this.listeners) listener(agentId)
    }, this.options.debounceMs ?? 250)
  }

  private dropInterest(agentId: string): void {
    const entry = this.interested.get(agentId)
    if (entry?.timer) clearTimeout(entry.timer)
    this.interested.delete(agentId)
  }

  subscribe(listener: (agentId: string) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  get size(): number {
    return this.watches.size
  }

  dispose(): void {
    for (const id of [...this.watches.keys()]) this.untrack(id)
    for (const id of [...this.interested.keys()]) this.dropInterest(id)
    this.listeners.clear()
  }

  private changed(agentId: string): void {
    const entry = this.watches.get(agentId)
    if (!entry) return
    if (this.now() - entry.lastRead > (this.options.idleMs ?? 60_000)) {
      this.untrack(agentId)
      return
    }
    // A reply arrives as many small appends: tell views once per burst.
    if (entry.timer) return
    entry.timer = setTimeout(() => {
      entry.timer = null
      if (!this.watches.has(agentId)) return
      for (const listener of this.listeners) listener(agentId)
    }, this.options.debounceMs ?? 250)
  }

  private sweep(now: number): void {
    const idleMs = this.options.idleMs ?? 60_000
    for (const [id, entry] of this.watches) if (now - entry.lastRead > idleMs) this.untrack(id)
  }

  private untrack(agentId: string): void {
    const entry = this.watches.get(agentId)
    if (!entry) return
    if (entry.timer) clearTimeout(entry.timer)
    try {
      entry.watcher.close()
    } catch {
      // already closed
    }
    this.watches.delete(agentId)
  }
}
