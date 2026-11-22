// The model and effort an agent is actually using, read from the agent CLI's own session file
// (the newest turn wins, so a mid-session /model change shows up):
//  - Claude: assistant entries carry `message.model`, plus `effort` / `perTurnEffort`;
//  - Codex: `turn_context` entries carry `model` and `effort`; the file name holds the session id.
import { open, readdir, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { AgentRecord } from '../../shared/model.ts'
import type { WorkerContext } from '../context.ts'
import type { SubagentFilesAdapter } from './subagent-files-adapter.ts'

const TAIL_BYTES = 256 * 1024
const RECENT_MS = 6 * 60 * 60 * 1000
const CODEX_INDEX_MS = 60_000

export type ModelReading = { model: string | null; effort: string | null }

export class SessionModelAdapter {
  private codexIndex = new Map<string, string>()
  private codexIndexedAt = 0
  private seen = new Map<string, number>()

  constructor(
    private readonly ctx: WorkerContext,
    private readonly claudeFiles: SubagentFilesAdapter,
    private readonly codexHomes: () => string[]
  ) {}

  async refresh(): Promise<void> {
    const now = this.ctx.now()
    const agents = Object.values(this.ctx.store.read().agents).filter((a) => (a.live || now - a.lastSeenAt < RECENT_MS) && (a.sessionId || a.role === 'subagent'))
    for (const agent of agents) {
      const path = await this.fileFor(agent)
      if (!path) continue
      let mtime = 0
      try {
        mtime = (await stat(path)).mtimeMs
      } catch {
        continue
      }
      if (this.seen.get(agent.id) === mtime) continue
      this.seen.set(agent.id, mtime)
      const reading = agent.agent === 'codex' ? readCodexModel(await tail(path)) : readClaudeModel(await tail(path))
      if (!reading.model && !reading.effort) continue
      const current = this.ctx.store.read().agents[agent.id]
      if (!current || (current.model === (reading.model ?? current.model) && current.effort === (reading.effort ?? current.effort))) continue
      this.ctx.store.upsertAgent(agent.id, current.lastSeenAt, { model: reading.model ?? undefined, effort: reading.effort ?? undefined, evidence: ['session-file'] }, () => current)
    }
  }

  private async fileFor(agent: AgentRecord): Promise<string | null> {
    if (agent.agent === 'codex') return agent.sessionId ? await this.codexFile(agent.sessionId) : null
    if (agent.agent === 'claude' || agent.agent === null || agent.role === 'subagent') return await this.claudeFiles.transcriptPathFor(agent)
    return null
  }

  private async codexFile(sessionId: string): Promise<string | null> {
    const now = this.ctx.now()
    if (!this.codexIndex.has(sessionId) && now - this.codexIndexedAt > CODEX_INDEX_MS) {
      this.codexIndexedAt = now
      for (const home of [join(homedir(), '.codex'), ...this.codexHomes()]) await indexCodexSessions(join(home, 'sessions'), this.codexIndex)
    }
    return this.codexIndex.get(sessionId) ?? null
  }
}

/** sessions/YYYY/MM/DD/rollout-<time>-<session id>.jsonl, newest days first, bounded. */
async function indexCodexSessions(root: string, index: Map<string, string>): Promise<void> {
  const list = async (dir: string) => (await readdir(dir).catch(() => [] as string[])).sort().reverse()
  let days = 0
  for (const year of await list(root)) {
    for (const month of await list(join(root, year))) {
      for (const day of await list(join(root, year, month))) {
        if (++days > 45) return
        for (const name of await list(join(root, year, month, day))) {
          const match = /^rollout-.*-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/.exec(name)
          if (match && !index.has(match[1])) index.set(match[1], join(root, year, month, day, name))
        }
      }
    }
  }
}

async function tail(path: string): Promise<string[]> {
  const handle = await open(path, 'r')
  try {
    const size = (await handle.stat()).size
    const start = Math.max(0, size - TAIL_BYTES)
    const buffer = Buffer.alloc(size - start)
    await handle.read(buffer, 0, buffer.length, start)
    const lines = buffer.toString('utf8').split('\n')
    if (start > 0) lines.shift()
    return lines
  } finally {
    await handle.close()
  }
}

export function readClaudeModel(lines: string[]): ModelReading {
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!lines[i].includes('"assistant"')) continue
    try {
      const entry = JSON.parse(lines[i]) as { type?: string; message?: { model?: string }; effort?: string; perTurnEffort?: string }
      if (entry.type !== 'assistant' || !entry.message?.model || entry.message.model === '<synthetic>') continue
      return { model: entry.message.model, effort: entry.perTurnEffort ?? entry.effort ?? null }
    } catch {
      // partial line
    }
  }
  return { model: null, effort: null }
}

export function readCodexModel(lines: string[]): ModelReading {
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!lines[i].includes('turn_context')) continue
    try {
      const entry = JSON.parse(lines[i]) as { type?: string; payload?: { model?: string; effort?: string; reasoning_effort?: string } }
      if (entry.type !== 'turn_context') continue
      return { model: entry.payload?.model ?? null, effort: entry.payload?.effort ?? entry.payload?.reasoning_effort ?? null }
    } catch {
      // partial line
    }
  }
  return { model: null, effort: null }
}
