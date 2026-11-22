// Saves each run (tasks, agents, messages, timeline) so finished runs can be replayed later.
import type { FlowStore } from './store.ts'
import type { Persistence, RunHistoryRecord } from './persistence.ts'

export class HistoryRecorder {
  private savedVersion = new Map<string, string>()

  constructor(
    private readonly store: FlowStore,
    private readonly persistence: Persistence,
    private readonly log: (message: string) => void
  ) {}

  async saveChangedRuns(): Promise<void> {
    const state = this.store.read()
    for (const run of Object.values(state.runs)) {
      const tasks = Object.values(state.tasks).filter((task) => task.runId === run.id)
      if (!tasks.length) continue
      const agents = Object.values(state.agents).filter((agent) => agent.runId === run.id)
      const fingerprint = `${run.version}|${run.state}|${tasks.map((t) => t.version).join(',')}|${agents.map((a) => a.version).join(',')}`
      if (this.savedVersion.get(run.id) === fingerprint) continue
      const ids = new Set<string>([run.id, ...tasks.map((t) => t.id), ...agents.map((a) => a.id)])
      const record: RunHistoryRecord = {
        version: 1,
        savedAt: Date.now(),
        run,
        tasks,
        agents,
        messages: state.messages.filter((message) => message.runId === run.id),
        events: this.store.events().filter((event) => event.runId === run.id || ids.has(event.entityId))
      }
      try {
        await this.persistence.saveRun(record)
        this.savedVersion.set(run.id, fingerprint)
      } catch (error) {
        this.log(`history save failed for ${run.id}: ${(error as Error).message}`)
      }
    }
  }
}
