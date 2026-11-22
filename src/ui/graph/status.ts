import type { AgentRecord, TaskRecord } from '../../shared/model.ts'
import type { FlowNodeData, VisualStatus } from './types.ts'

export function agentStatus(agent: AgentRecord): VisualStatus {
  switch (agent.state) {
    case 'working':
      return agent.live ? 'running' : 'unknown'
    case 'waiting':
      return 'waiting'
    case 'blocked':
      return 'blocked'
    case 'done':
      return agent.outcome === 'cancellation' ? 'cancelled' : 'done'
    case 'failed':
      return 'failed'
    case 'idle':
      return 'idle'
    default:
      return 'unknown'
  }
}

export function taskStatus(task: TaskRecord): VisualStatus {
  switch (task.state) {
    case 'RUNNING':
      return 'running'
    case 'REVIEW':
      return 'review'
    case 'TESTING':
      return 'testing'
    case 'READY':
    case 'PENDING':
      return 'ready'
    case 'RETRYING':
      return 'running'
    case 'BLOCKED':
      return 'blocked'
    case 'FAILED':
      return 'failed'
    case 'CANCELLED':
      return 'cancelled'
    case 'APPROVED':
    case 'MERGED':
    case 'DONE':
      return 'done'
  }
}

export const STATUS_LABEL: Record<VisualStatus, string> = {
  running: 'Running',
  waiting: 'Waiting',
  ready: 'Ready',
  blocked: 'Blocked',
  failed: 'Failed',
  review: 'In review',
  testing: 'Testing',
  done: 'Done',
  cancelled: 'Cancelled',
  idle: 'Idle',
  unknown: 'Unknown'
}

/** Animated statuses per the spec: running, review, testing. */
export function isAnimatedStatus(status: VisualStatus): boolean {
  return status === 'running' || status === 'review' || status === 'testing'
}

export function isFinished(status: VisualStatus): boolean {
  return status === 'done' || status === 'cancelled' || status === 'failed'
}

export const AGENT_LABEL: Record<string, string> = {
  claude: 'Claude',
  codex: 'Codex',
  antigravity: 'AGY',
  gemini: 'Gemini',
  opencode: 'OpenCode',
  opencode2: 'OpenCode',
  cursor: 'Cursor',
  copilot: 'Copilot',
  grok: 'Grok',
  kiro: 'Kiro',
  devin: 'Devin',
  droid: 'Droid'
}

export function agentKindLabel(kind: string | null): string {
  if (!kind) return 'Agent'
  return AGENT_LABEL[kind] ?? kind.charAt(0).toUpperCase() + kind.slice(1)
}

/** "claude-opus-5-5" → "Opus 5.5"; unknown ids pass through. */
export function shortModel(model: string | null): string | null {
  if (!model) return null
  const claude = /^claude-(opus|sonnet|haiku|fable)-(\d+)(?:-(\d+))?/i.exec(model)
  if (claude) return `${claude[1][0].toUpperCase()}${claude[1].slice(1)} ${claude[2]}${claude[3] ? '.' + claude[3] : ''}`
  return model.length > 24 ? model.slice(0, 23) + '…' : model
}

export function formatDuration(ms: number): string {
  if (ms < 0) ms = 0
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${s % 60}s`
  const h = Math.floor(m / 60)
  if (h < 48) return `${h}h ${m % 60}m`
  return `${Math.floor(h / 24)}d ${h % 24}h`
}

export function formatTokens(tokens: number | null): string | null {
  if (tokens == null) return null
  if (tokens < 1000) return `${tokens}`
  if (tokens < 1_000_000) return `${(tokens / 1000).toFixed(tokens < 10000 ? 1 : 0)}k`
  return `${(tokens / 1_000_000).toFixed(1)}M`
}

export const KIND_LABEL: Record<FlowNodeData['kind'], string> = {
  lead: 'Lead',
  team: 'Team',
  agent: 'Agent',
  subagent: 'Subagent',
  task: 'Task',
  review: 'Review',
  test: 'Testing',
  worktree: 'Worktree',
  blocker: 'Blocker',
  project: 'Project'
}

/** What a card is called for screen readers and keyboard focus: "Agent Worker: API, Running". */
export function cardLabel(data: Pick<FlowNodeData, 'kind' | 'title' | 'status'>): string {
  return `${KIND_LABEL[data.kind]} ${data.title}, ${STATUS_LABEL[data.status]}`
}
