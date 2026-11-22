// Crash recovery and run history on disk, in the plugin's own state folder (never the repo).
// Bounded: one compact snapshot plus at most MAX_RUNS run records.
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { homedir, platform } from 'node:os'
import { join } from 'node:path'
import type { FlowEvent, FlowSnapshot } from '../../shared/events.ts'
import type { AgentRecord, MessageRecord, RunRecord, TaskRecord } from '../../shared/model.ts'

const MAX_RUNS = 60
const MAX_RUN_EVENTS = 2000
const SNAPSHOT_FILE = 'snapshot.json'
const PRUNE_EVERY = 10

export type RunHistoryRecord = {
  version: 1
  savedAt: number
  run: RunRecord
  tasks: TaskRecord[]
  agents: AgentRecord[]
  messages: MessageRecord[]
  events: FlowEvent[]
}

export type RunHistorySummary = Pick<RunRecord, 'id' | 'objective' | 'state' | 'startedAt' | 'endedAt' | 'taskCount'> & { savedAt: number }

export function stateDir(): string {
  const home = homedir()
  if (platform() === 'darwin') return join(home, 'Library/Application Support/orca-agent-flow')
  if (platform() === 'win32') return join(process.env.APPDATA ?? join(home, 'AppData/Roaming'), 'orca-agent-flow')
  return join(process.env.XDG_STATE_HOME ?? join(home, '.local/state'), 'orca-agent-flow')
}

export class Persistence {
  private historyDir: string
  private savesSincePrune = 0

  constructor(private readonly dir = stateDir()) {
    this.historyDir = join(dir, 'history')
  }

  async init(): Promise<void> {
    await mkdir(this.historyDir, { recursive: true, mode: 0o700 })
  }

  async loadSnapshot(): Promise<FlowSnapshot | null> {
    try {
      const parsed = JSON.parse(await readFile(join(this.dir, SNAPSHOT_FILE), 'utf8')) as FlowSnapshot
      return parsed?.state && typeof parsed.state.seq === 'number' ? parsed : null
    } catch {
      return null
    }
  }

  async saveSnapshot(snapshot: FlowSnapshot): Promise<void> {
    await atomicWrite(join(this.dir, SNAPSHOT_FILE), JSON.stringify(snapshot))
  }

  async saveRun(record: RunHistoryRecord): Promise<void> {
    const trimmed = { ...record, events: record.events.slice(-MAX_RUN_EVENTS) }
    await atomicWrite(join(this.historyDir, `${safeName(record.run.id)}.json`), JSON.stringify(trimmed))
    // Listing the folder is the costly part; trimming old runs now and then is enough.
    if (this.savesSincePrune++ % PRUNE_EVERY === 0) await this.prune()
  }

  async listRuns(): Promise<RunHistorySummary[]> {
    const out: RunHistorySummary[] = []
    for (const name of await this.files()) {
      try {
        const record = JSON.parse(await readFile(join(this.historyDir, name), 'utf8')) as RunHistoryRecord
        const { id, objective, state, startedAt, endedAt, taskCount } = record.run
        out.push({ id, objective, state, startedAt, endedAt, taskCount, savedAt: record.savedAt })
      } catch {
        // skip unreadable files
      }
    }
    return out.sort((a, b) => (b.startedAt ?? b.savedAt) - (a.startedAt ?? a.savedAt)).slice(0, MAX_RUNS)
  }

  async loadRun(runId: string): Promise<RunHistoryRecord | null> {
    try {
      return JSON.parse(await readFile(join(this.historyDir, `${safeName(runId)}.json`), 'utf8')) as RunHistoryRecord
    } catch {
      return null
    }
  }

  private async files(): Promise<string[]> {
    try {
      return (await readdir(this.historyDir)).filter((name) => name.endsWith('.json'))
    } catch {
      return []
    }
  }

  private async prune(): Promise<void> {
    const names = await this.files()
    if (names.length <= MAX_RUNS) return
    const withTimes = await Promise.all(names.map(async (name) => ({ name, mtime: (await stat(join(this.historyDir, name))).mtimeMs })))
    withTimes.sort((a, b) => a.mtime - b.mtime)
    for (const { name } of withTimes.slice(0, names.length - MAX_RUNS)) await rm(join(this.historyDir, name), { force: true })
  }
}

export function safeName(id: string): string {
  return id.replace(/[^A-Za-z0-9_.-]/g, '_').slice(0, 120)
}

async function atomicWrite(path: string, data: string): Promise<void> {
  const tmp = `${path}.${process.pid}.tmp`
  await writeFile(tmp, data, { mode: 0o600 })
  await rename(tmp, path)
}
