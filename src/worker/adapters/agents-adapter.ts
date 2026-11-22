// Live agents from Orca's host API: workspace.list + agents.list, then agent.status.changed.
import type { AgentRuntimeState, WorktreeRecord } from '../../shared/model.ts'
import { newAgent, type WorkerContext } from '../context.ts'
import { dedupeAgent } from '../state/merge-agents.ts'

type HostAgentRow = {
  terminalId: string | null
  title: string | null
  agent: string | null
  state: 'working' | 'blocked' | 'waiting' | 'done'
  stateStartedAt: number
  sessionId?: string | null
  task?: { title: string } | null
}

type StatusEvent = {
  workspaceId: string | null
  workspaceListId?: string
  paneKey: string
  terminalId?: string
  title?: string
  state: 'working' | 'blocked' | 'waiting' | 'done'
  receivedAt: number
  mainAgent?: { state: string; outcome?: string; stateStartedAt: number }
  sessionId?: string
}

const MAX_WORKSPACES_PER_SCAN = 40

export class AgentsAdapter {
  private workspaceByPath = new Map<string, WorktreeRecord>()
  private scanning = false

  constructor(private readonly ctx: WorkerContext) {}

  worktreeForPath(path: string | null): WorktreeRecord | null {
    return path ? this.workspaceByPath.get(path) ?? null : null
  }

  /** Full re-scan: every workspace and the agents in the active ones. */
  async scan(): Promise<void> {
    if (this.scanning) return
    this.scanning = true
    try {
      const { host } = this.ctx.orca
      if (!host.has('workspace.list')) return
      const listed = await host.call('workspace.list', { includeStatus: true })
      const seen = new Set<string>()
      for (const row of listed.workspaces) {
        const record: WorktreeRecord = {
          id: row.id,
          name: row.name,
          path: row.path,
          branch: row.branch,
          project: row.project ?? null,
          projectId: row.projectId ?? null,
          hostId: row.hostId,
          kind: row.kind,
          status: row.status?.state ?? null,
          terminalCount: row.status?.terminalCount ?? null,
          lastActivityAt: row.status?.lastActivityAt ?? null,
          version: 0
        }
        seen.add(row.id)
        this.workspaceByPath.set(row.path, record)
        const previous = this.ctx.store.read().worktrees[row.id]
        this.ctx.store.put({ entity: 'worktree', id: row.id, value: { ...record, version: (previous?.version ?? 0) + 1 } })
        if (!previous) {
          this.ctx.store.emit({ ts: this.ctx.now(), kind: 'worktree.created', source: 'host-call', entityId: row.id, summary: `Worktree ${row.name} (${row.branch ?? 'no branch'})` })
        }
      }
      for (const id of Object.keys(this.ctx.store.read().worktrees)) {
        if (!seen.has(id) && !listed.truncated) this.ctx.store.put({ entity: 'worktree', id, value: null })
      }
      await this.scanProjects()
      await this.scanAgents(listed.workspaces)
    } catch (error) {
      this.ctx.log(`agents scan failed: ${(error as Error).message}`)
    } finally {
      this.scanning = false
    }
  }

  /** Orca's projects (name + root path) for grouping agents into project boxes. */
  private async scanProjects(): Promise<void> {
    const { host } = this.ctx.orca
    if (!host.has('project.list')) return
    try {
      const { projects, truncated } = await host.call('project.list', {})
      const seen = new Set<string>()
      for (const p of projects) {
        seen.add(p.id)
        this.ctx.store.put({ entity: 'project', id: p.id, value: { id: p.id, name: p.name, path: p.path, kind: p.kind, hostId: p.hostId, hidden: p.hidden === true } })
      }
      if (!truncated) for (const id of Object.keys(this.ctx.store.read().projects ?? {})) if (!seen.has(id)) this.ctx.store.put({ entity: 'project', id, value: null })
    } catch (error) {
      this.ctx.log(`project.list failed: ${(error as Error).message}`)
    }
  }

  private async scanAgents(workspaces: { id: string; path: string; branch: string | null; status?: { state: string; terminalCount: number } }[]): Promise<void> {
    const { host } = this.ctx.orca
    if (!host.has('agents.list')) return
    const perWorkspace = (this.ctx.orca.api?.minor ?? 0) >= 10
    const targets = perWorkspace
      ? workspaces.filter((w) => (w.status?.terminalCount ?? 0) > 0 || (w.status && w.status.state !== 'inactive')).slice(0, MAX_WORKSPACES_PER_SCAN)
      : []
    const calls = perWorkspace ? targets.map((w) => ({ workspace: w as typeof w | null })) : [{ workspace: null }]
    for (const { workspace } of calls) {
      try {
        // `workspaceId` exists from host API 1.10; older Orca lists the focused workspace only.
        const result = await host.call('agents.list', (workspace ? { workspaceId: workspace.id } : {}) as Record<string, never>)
        for (const row of result.agents as HostAgentRow[]) this.applyRow(row, workspace)
      } catch (error) {
        this.ctx.log(`agents.list failed for ${workspace?.id ?? 'focused workspace'}: ${(error as Error).message}`)
      }
    }
  }

  private applyRow(row: HostAgentRow, workspace: { id: string; path: string; branch: string | null } | null): void {
    const now = this.ctx.now()
    const existingId = this.ctx.identity.resolve({ terminalId: row.terminalId, sessionId: row.sessionId ?? null })
    const id = existingId ?? (row.terminalId ? `term:${row.terminalId}` : row.sessionId ? `session:${row.sessionId}` : null)
    if (!id) return
    const previous = this.ctx.store.read().agents[id]
    const state = mapState(row.state)
    this.ctx.store.upsertAgent(
      id,
      row.stateStartedAt || now,
      {
        agent: row.agent ?? undefined,
        title: row.title ?? undefined,
        terminalId: row.terminalId ?? undefined,
        sessionId: row.sessionId ?? undefined,
        workspaceId: workspace?.id,
        worktreePath: workspace?.path,
        branch: workspace?.branch ?? undefined,
        description: row.task?.title ?? undefined,
        state,
        stateSince: row.stateStartedAt || undefined,
        live: state !== 'done',
        startedAt: previous?.startedAt ?? row.stateStartedAt ?? now,
        evidence: ['host-call']
      },
      () => newAgent(id, 'agent', now)
    )
    this.ctx.identity.link(id, { terminalId: row.terminalId, sessionId: row.sessionId ?? null })
    dedupeAgent(this.ctx.store, this.ctx.identity, id)
    if (!previous) this.ctx.store.emit({ ts: now, kind: 'agent.created', source: 'host-call', entityId: id, summary: `${row.agent ?? 'Agent'} ${row.title ?? ''} found (${row.state})`.trim() })
  }

  /** agent.status.changed: the most precise live signal Orca gives. */
  onStatus(event: StatusEvent): void {
    const now = this.ctx.now()
    const keys = { paneKey: event.paneKey, terminalId: event.terminalId ?? null, sessionId: event.sessionId ?? null }
    const id = this.ctx.identity.resolve(keys) ?? (event.terminalId ? `term:${event.terminalId}` : `pane:${event.paneKey}`)
    const previous = this.ctx.store.read().agents[id]
    const main = event.mainAgent
    const state = mapState((main?.state as StatusEvent['state']) ?? event.state, main?.outcome)
    const workspace = event.workspaceListId ? this.ctx.store.read().worktrees[event.workspaceListId] : undefined
    const record = this.ctx.store.upsertAgent(
      id,
      event.receivedAt || now,
      {
        paneKey: event.paneKey,
        terminalId: event.terminalId,
        sessionId: event.sessionId,
        title: event.title,
        workspaceId: event.workspaceListId ?? event.workspaceId ?? undefined,
        worktreePath: workspace?.path,
        branch: workspace?.branch ?? undefined,
        state,
        outcome: main?.outcome ?? undefined,
        stateSince: main?.stateStartedAt ?? event.receivedAt,
        live: state === 'working' || state === 'blocked' || state === 'waiting',
        startedAt: previous?.startedAt ?? event.receivedAt ?? now,
        endedAt: state === 'done' || state === 'failed' ? event.receivedAt : null,
        evidence: ['host-event']
      },
      () => newAgent(id, 'agent', now)
    )
    this.ctx.identity.link(id, keys)
    dedupeAgent(this.ctx.store, this.ctx.identity, id)
    if (!previous || previous.state !== record.state) {
      const kind = !previous ? 'agent.started' : state === 'failed' ? 'agent.failed' : state === 'done' ? 'agent.completed' : 'agent.status_changed'
      this.ctx.store.emit({
        ts: event.receivedAt || now,
        kind,
        source: 'host-event',
        entityId: id,
        runId: record.runId,
        summary: `${record.title ?? record.agent ?? 'Agent'}: ${previous?.state ?? 'new'} → ${state}${main?.outcome ? ` (${main.outcome})` : ''}`
      })
    }
  }
}

export function mapState(state: 'working' | 'blocked' | 'waiting' | 'done', outcome?: string): AgentRuntimeState {
  if (state === 'done' && outcome && (outcome === 'failure' || outcome === 'interruption')) return 'failed'
  return state
}
