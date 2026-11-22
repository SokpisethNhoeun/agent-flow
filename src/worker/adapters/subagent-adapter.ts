// Claude subagents from the agent.tool.before/after hooks. Claude Code spawns subagents with its
// `Agent` tool (older versions: `Task`); the hook carries the call id and the subagent's brief.
// Other agents do not report subagent identity, so nothing is drawn for them.
import { redact, truncate } from '../../shared/redact.ts'
import { newAgent, type WorkerContext } from '../context.ts'

export const SUBAGENT_TOOLS = new Set(['Agent', 'Task'])

type ToolEvent = {
  agent: string
  workspaceId: string | null
  terminalId?: string
  tool: string
  input: unknown
  callId?: string
  output?: unknown
}

export class SubagentAdapter {
  private fallbackCounter = 0

  constructor(private readonly ctx: WorkerContext) {}

  /** Must return fast: Claude Code waits for this hook. Never denies. */
  onToolBefore(event: ToolEvent): void {
    const now = this.ctx.now()
    const parentId = this.resolveParent(event)
    const callKey = event.callId ?? `${event.terminalId ?? 'na'}-${now}-${++this.fallbackCounter}`
    this.recordToolCall(callKey, event, parentId, 'started', now)
    if (!SUBAGENT_TOOLS.has(event.tool)) return
    const input = asRecord(event.input)
    const id = `sub:${callKey}`
    const parent = parentId ? this.ctx.store.read().agents[parentId] : undefined
    const description = str(input.description) ?? str(input.prompt)?.slice(0, 120) ?? null
    this.ctx.store.upsertAgent(
      id,
      now,
      {
        role: 'subagent',
        agent: event.agent,
        parentId,
        callId: event.callId ?? null,
        subagentType: str(input.subagent_type) ?? 'general-purpose',
        description: description ? redact(description) : null,
        title: str(input.description) ?? str(input.subagent_type) ?? 'Subagent',
        model: str(input.model),
        workspaceId: event.workspaceId ?? parent?.workspaceId ?? null,
        worktreePath: parent?.worktreePath ?? null,
        branch: parent?.branch ?? null,
        runId: parent?.runId ?? null,
        taskId: parent?.taskId ?? null,
        account: parent?.account ?? null,
        state: 'working',
        live: true,
        startedAt: now,
        stateSince: now,
        evidence: ['hook']
      },
      () => newAgent(id, 'subagent', now)
    )
    this.ctx.store.emit({
      ts: now,
      kind: 'subagent.spawned',
      source: 'hook',
      entityId: id,
      targetId: parentId,
      runId: parent?.runId ?? null,
      summary: `${parent?.title ?? event.agent} spawned subagent: ${truncate(description ?? 'subagent', 100)}`
    })
  }

  onToolAfter(event: ToolEvent): void {
    const now = this.ctx.now()
    const parentId = this.resolveParent(event)
    if (event.callId) this.recordToolCall(event.callId, event, parentId, 'finished', now)
    if (!SUBAGENT_TOOLS.has(event.tool) || !event.callId) return
    const id = `sub:${event.callId}`
    const existing = this.ctx.store.read().agents[id]
    if (!existing) return
    const failed = looksFailed(event.output)
    this.ctx.store.upsertAgent(id, now, { state: failed ? 'failed' : 'done', outcome: failed ? 'failure' : 'success', live: false, endedAt: now, stateSince: now, evidence: ['hook'] }, () => existing)
    this.ctx.store.emit({
      ts: now,
      kind: 'subagent.completed',
      source: 'hook',
      entityId: id,
      targetId: existing.parentId,
      runId: existing.runId,
      summary: `Subagent ${existing.title ?? ''} ${failed ? 'failed' : 'finished'}`.replace(/\s+/g, ' ')
    })
  }

  private resolveParent(event: ToolEvent): string | null {
    const direct = this.ctx.identity.resolve({ terminalId: event.terminalId ?? null })
    if (direct) return direct
    if (!event.workspaceId) return null
    // Only attribute by workspace when exactly one live agent of that kind is there.
    const candidates = Object.values(this.ctx.store.read().agents).filter(
      (agent) => agent.role !== 'subagent' && agent.live && agent.workspaceId === event.workspaceId && (agent.agent ?? event.agent) === event.agent
    )
    return candidates.length === 1 ? candidates[0].id : null
  }

  private recordToolCall(callKey: string, event: ToolEvent, agentId: string | null, phase: 'started' | 'finished', now: number): void {
    this.ctx.store.put({
      entity: 'toolCall',
      id: callKey,
      value: { id: callKey, agentId, terminalId: event.terminalId ?? null, tool: event.tool, summary: summarizeInput(event.tool, event.input), at: now, phase }
    })
  }
}

export function summarizeInput(tool: string, input: unknown): string {
  const record = asRecord(input)
  const pick = str(record.description) ?? str(record.command) ?? str(record.file_path) ?? str(record.pattern) ?? str(record.url) ?? str(record.prompt)
  return redact(truncate(pick ?? tool, 160))
}

function looksFailed(output: unknown): boolean {
  const record = asRecord(output)
  if (record.is_error === true || record.isError === true) return true
  const status = str(record.status)
  return status === 'error' || status === 'failed'
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}
