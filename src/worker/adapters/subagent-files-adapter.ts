// Claude subagents for every Claude session (terminal or chat), from the files Claude Code itself
// writes: <projects>/<project>/<session>/subagents/agent-<id>.meta.json (+ .jsonl transcript).
// The meta file names the spawning tool call (`toolUseId`), the same id Orca's tool hook reports,
// so a subagent seen by both sources is one node. Read-only; nothing is written.
import { open, readdir, readFile, realpath, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { AgentRecord } from '../../shared/model.ts'
import { redactAndTruncate } from '../../shared/redact.ts'
import { newAgent, type WorkerContext } from '../context.ts'

type Meta = { agentType?: string; description?: string; toolUseId?: string; model?: string; finished?: boolean; spawnDepth?: number }

/** A subagent still writing within this window counts as working (with a live parent). */
const ACTIVE_WRITE_MS = 90_000
const RECENT_SESSION_MS = 6 * 60 * 60 * 1000
const DIR_RETRY_MS = 60_000
const MAX_SESSIONS_PER_SCAN = 40
const MAX_META_CACHE = 2000

export class SubagentFilesAdapter {
  private sessionDirs = new Map<string, { dir: string | null; checkedAt: number }>()
  private seenMtime = new Map<string, number>()
  private metaCache = new Map<string, { mtime: number; meta: Meta }>()
  /** subagent node id → its transcript file, for the Output tab. */
  private transcripts = new Map<string, string>()
  private sessionFiles = new Map<string, string>()

  constructor(
    private readonly ctx: WorkerContext,
    private readonly claudeHomes: () => string[]
  ) {}

  transcriptFor(agentId: string): string | null {
    return this.transcripts.get(agentId) ?? null
  }

  /** The transcript of a subagent, or of a Claude session (chat or terminal) by its session id. */
  async transcriptPathFor(agent: AgentRecord): Promise<string | null> {
    if (agent.role === 'subagent') return this.transcriptFor(agent.id)
    if (!agent.sessionId || (agent.agent !== 'claude' && agent.agent !== null)) return null
    const cached = this.sessionFiles.get(agent.sessionId)
    if (cached !== undefined) return cached
    let found: string | null = null
    for (const root of await this.projectRoots()) {
      let projects: string[] = []
      try {
        projects = await readdir(root)
      } catch {
        continue
      }
      for (const project of projects) {
        const file = join(root, project, `${agent.sessionId}.jsonl`)
        try {
          if ((await stat(file)).isFile()) {
            found = file
            break
          }
        } catch {
          // not here
        }
      }
      if (found) break
    }
    if (found) this.sessionFiles.set(agent.sessionId, found)
    return found
  }

  async scan(): Promise<void> {
    const now = this.ctx.now()
    const roots = await this.projectRoots()
    if (!roots.length) return
    const parents = Object.values(this.ctx.store.read().agents)
      .filter((a) => a.sessionId && a.role !== 'subagent' && (a.agent === 'claude' || a.agent === null) && (a.live || now - a.lastSeenAt < RECENT_SESSION_MS))
      .sort((a, b) => Number(b.live) - Number(a.live) || b.lastSeenAt - a.lastSeenAt)
      .slice(0, MAX_SESSIONS_PER_SCAN)
    for (const parent of parents) {
      const dir = await this.subagentDir(roots, parent.sessionId!, now)
      if (dir) await this.scanDir(dir, parent, now)
    }
  }

  private async projectRoots(): Promise<string[]> {
    const candidates = [join(homedir(), '.claude', 'projects'), ...this.claudeHomes().map((home) => join(home, 'projects'))]
    const out = new Set<string>()
    for (const candidate of candidates) {
      try {
        out.add(await realpath(candidate))
      } catch {
        // not there
      }
    }
    return [...out]
  }

  private async subagentDir(roots: string[], sessionId: string, now: number): Promise<string | null> {
    const cached = this.sessionDirs.get(sessionId)
    if (cached && (cached.dir || now - cached.checkedAt < DIR_RETRY_MS)) return cached.dir
    let found: string | null = null
    for (const root of roots) {
      let projects: string[]
      try {
        projects = await readdir(root)
      } catch {
        continue
      }
      for (const project of projects) {
        const dir = join(root, project, sessionId, 'subagents')
        try {
          if ((await stat(dir)).isDirectory()) {
            found = dir
            break
          }
        } catch {
          // not this project
        }
      }
      if (found) break
    }
    this.sessionDirs.set(sessionId, { dir: found, checkedAt: now })
    return found
  }

  private async scanDir(dir: string, parent: AgentRecord, now: number): Promise<void> {
    let names: string[]
    try {
      names = (await readdir(dir)).filter((name) => name.endsWith('.meta.json'))
    } catch {
      return
    }
    for (const name of names) {
      const base = name.slice(0, -'.meta.json'.length)
      const metaPath = join(dir, name)
      const transcriptPath = join(dir, `${base}.jsonl`)
      let metaMtime = 0
      let mtime = 0
      try {
        metaMtime = (await stat(metaPath)).mtimeMs
        mtime = Math.max(metaMtime, await stat(transcriptPath).then((s) => s.mtimeMs).catch(() => 0))
      } catch {
        continue
      }
      // The meta file rarely changes (once at spawn, once at finish): parse it only when it does.
      let meta: Meta
      const cachedMeta = this.metaCache.get(metaPath)
      if (cachedMeta && cachedMeta.mtime === metaMtime) meta = cachedMeta.meta
      else {
        try {
          meta = JSON.parse(await readFile(metaPath, 'utf8')) as Meta
        } catch {
          continue
        }
        this.metaCache.set(metaPath, { mtime: metaMtime, meta })
        if (this.metaCache.size > MAX_META_CACHE) this.metaCache.delete(this.metaCache.keys().next().value!)
      }
      const id = meta.toolUseId ? `sub:${meta.toolUseId}` : `sub:file:${base}`
      this.transcripts.set(id, transcriptPath)
      const existing = this.ctx.store.read().agents[id]
      const writing = now - mtime < ACTIVE_WRITE_MS
      const finished = meta.finished === true
      const live = !finished && writing && parent.live
      // Unchanged files only need a liveness refresh (a subagent goes quiet when its parent stops).
      if (this.seenMtime.get(id) === mtime && existing && existing.live === live) continue
      this.seenMtime.set(id, mtime)
      const startedAt = existing?.startedAt ?? (await firstTimestamp(transcriptPath)) ?? mtime
      this.ctx.store.upsertAgent(
        id,
        mtime,
        {
          role: 'subagent',
          agent: 'claude',
          parentId: existing?.parentId ?? parent.id,
          callId: meta.toolUseId ?? null,
          subagentType: meta.agentType ?? existing?.subagentType ?? 'general-purpose',
          description: meta.description ? redactAndTruncate(meta.description, 300) : existing?.description ?? null,
          title: meta.description ? redactAndTruncate(meta.description, 120) : existing?.title ?? 'Subagent',
          model: meta.model ?? existing?.model ?? null,
          runId: parent.runId,
          taskId: parent.taskId,
          workspaceId: parent.workspaceId,
          worktreePath: parent.worktreePath,
          branch: parent.branch,
          account: parent.account,
          state: finished ? 'done' : live ? 'working' : 'unknown',
          outcome: finished ? 'success' : null,
          live,
          startedAt,
          stateSince: mtime,
          endedAt: finished ? mtime : null,
          evidence: ['session-file']
        },
        () => newAgent(id, 'subagent', now)
      )
      if (!existing) {
        this.ctx.store.emit({ id: `subagent.file:${id}`, ts: startedAt, kind: 'subagent.spawned', source: 'session-file', entityId: id, targetId: parent.id, runId: parent.runId, summary: `${parent.title ?? 'Claude'} spawned subagent: ${meta.description ?? meta.agentType ?? 'subagent'}` })
      } else if (finished && existing.state !== 'done') {
        this.ctx.store.emit({ id: `subagent.done:${id}`, ts: mtime, kind: 'subagent.completed', source: 'session-file', entityId: id, targetId: parent.id, runId: parent.runId, summary: `Subagent ${meta.description ?? ''} finished`.trim() })
      }
    }
  }
}

async function firstTimestamp(path: string): Promise<number | null> {
  try {
    const handle = await open(path, 'r')
    try {
      const { buffer, bytesRead } = await handle.read(Buffer.alloc(8192), 0, 8192, 0)
      const line = buffer.subarray(0, bytesRead).toString('utf8').split('\n')[0]
      const ts = (JSON.parse(line) as { timestamp?: string }).timestamp
      const ms = ts ? Date.parse(ts) : NaN
      return Number.isFinite(ms) ? ms : null
    } finally {
      await handle.close()
    }
  } catch {
    return null
  }
}
