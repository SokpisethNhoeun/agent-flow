import type { AgentRecord, EvidenceSource, FlowState, GateRecord, MessageRecord, RunRecord, TaskRecord, ToolCallRecord, WorktreeRecord, AccountRecord, Capabilities, LabelConfig, ProjectRecord } from './model.ts'

/** Semantic timeline event. Drives the bottom timeline, history and edge animation. */
export type FlowEventKind =
  | 'agent.created'
  | 'agent.started'
  | 'agent.status_changed'
  | 'agent.completed'
  | 'agent.failed'
  | 'subagent.spawned'
  | 'subagent.completed'
  | 'task.created'
  | 'task.assigned'
  | 'task.started'
  | 'task.updated'
  | 'task.completed'
  | 'task.failed'
  | 'task.blocked'
  | 'task.retried'
  | 'review.started'
  | 'review.completed'
  | 'test.started'
  | 'test.completed'
  | 'worktree.created'
  | 'worktree.updated'
  | 'worktree.removed'
  | 'message.sent'
  | 'tool.called'
  | 'orchestration.started'
  | 'orchestration.completed'
  | 'command.executed'
  | 'command.failed'

export type FlowEvent = {
  id: string
  seq: number
  ts: number
  kind: FlowEventKind
  source: EvidenceSource | 'command'
  /** Entity the event is about (agent, task, run, worktree id). */
  entityId: string
  /** For handoffs/messages: the other end, so the UI can animate that edge. */
  targetId?: string | null
  runId?: string | null
  summary: string
}

export type EntityPatch =
  | { entity: 'agent'; id: string; value: AgentRecord | null }
  | { entity: 'task'; id: string; value: TaskRecord | null }
  | { entity: 'run'; id: string; value: RunRecord | null }
  | { entity: 'gate'; id: string; value: GateRecord | null }
  | { entity: 'worktree'; id: string; value: WorktreeRecord | null }
  | { entity: 'account'; id: string; value: AccountRecord | null }
  | { entity: 'project'; id: string; value: ProjectRecord | null }
  | { entity: 'message'; id: string; value: MessageRecord }
  | { entity: 'toolCall'; id: string; value: ToolCallRecord }
  | { entity: 'capabilities'; id: 'capabilities'; value: Capabilities }
  | { entity: 'labels'; id: 'labels'; value: LabelConfig }

/** Ordered delta the worker pushes; `fromSeq` must equal the client's seq or it re-snapshots. */
export type FlowDelta = {
  fromSeq: number
  toSeq: number
  patches: EntityPatch[]
  events: FlowEvent[]
}

export type FlowSnapshot = {
  state: FlowState
  events: FlowEvent[]
}

export const MAX_MESSAGES = 300
export const MAX_TOOL_CALLS = 300
export const MAX_TIMELINE = 1000

/** Applies a patch to a state copy in place. Shared so UI and worker agree byte for byte. */
export function applyPatch(state: FlowState, patch: EntityPatch): void {
  switch (patch.entity) {
    case 'agent':
      setOrDelete(state.agents, patch.id, patch.value)
      break
    case 'task':
      setOrDelete(state.tasks, patch.id, patch.value)
      break
    case 'run':
      setOrDelete(state.runs, patch.id, patch.value)
      break
    case 'gate':
      setOrDelete(state.gates, patch.id, patch.value)
      break
    case 'worktree':
      setOrDelete(state.worktrees, patch.id, patch.value)
      break
    case 'account':
      setOrDelete(state.accounts, patch.id, patch.value)
      break
    case 'project':
      // Older snapshots have no projects map.
      state.projects ??= {}
      setOrDelete(state.projects, patch.id, patch.value)
      break
    case 'message': {
      const index = state.messages.findIndex((message) => message.id === patch.id)
      if (index >= 0) state.messages[index] = patch.value
      else state.messages.push(patch.value)
      if (state.messages.length > MAX_MESSAGES) state.messages.splice(0, state.messages.length - MAX_MESSAGES)
      break
    }
    case 'toolCall': {
      const index = state.toolCalls.findIndex((call) => call.id === patch.id)
      if (index >= 0) state.toolCalls[index] = patch.value
      else state.toolCalls.push(patch.value)
      if (state.toolCalls.length > MAX_TOOL_CALLS) state.toolCalls.splice(0, state.toolCalls.length - MAX_TOOL_CALLS)
      break
    }
    case 'capabilities':
      state.capabilities = patch.value
      break
    case 'labels':
      state.labels = patch.value
      break
  }
}

function setOrDelete<T>(map: Record<string, T>, id: string, value: T | null): void {
  if (value === null) delete map[id]
  else map[id] = value
}
