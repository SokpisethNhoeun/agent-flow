// Normalized, authoritative Agent Flow state shared by the worker and every UI.
// Values the runtime does not provide stay null; the UI shows them as unavailable.

export type EvidenceSource = 'host-event' | 'host-call' | 'hook' | 'cli-poll' | 'session-file' | 'launch-capture' | 'config'

export type AgentRuntimeState = 'working' | 'blocked' | 'waiting' | 'done' | 'failed' | 'idle' | 'unknown'

export type AgentRole = 'lead' | 'worker' | 'agent' | 'subagent'

export type AccountRef = {
  accountId: string | null
  /** Display label: the person's own label from settings, else the account email. */
  label: string | null
  provider: string | null
  source: EvidenceSource
}

export type AgentRecord = {
  id: string
  role: AgentRole
  /** Orca agent kind: claude, codex, antigravity, gemini, opencode… */
  agent: string | null
  title: string | null
  parentId: string | null
  runId: string | null
  dispatchId: string | null
  taskId: string | null
  terminalId: string | null
  terminalHandle: string | null
  paneKey: string | null
  sessionId: string | null
  workspaceId: string | null
  worktreePath: string | null
  /** Repository the worktree belongs to (from its .git pointer), when known. */
  repoRoot?: string | null
  /** Orca project id, when Orca named it for this agent (orchestration dispatches do). */
  projectId?: string | null
  branch: string | null
  model: string | null
  effort: string | null
  account: AccountRef | null
  state: AgentRuntimeState
  outcome: string | null
  stateSince: number | null
  startedAt: number | null
  endedAt: number | null
  /** Last time any runtime evidence touched this agent. */
  lastSeenAt: number
  /** True only when live evidence (status event, running dispatch, live session) says it runs. */
  live: boolean
  tokens: number | null
  messageCount: number | null
  failureCount: number
  retryOfDispatchId: string | null
  /** Subagent only: the tool call that created it. */
  callId: string | null
  subagentType: string | null
  description: string | null
  evidence: EvidenceSource[]
  version: number
}

export type TaskState =
  | 'PENDING'
  | 'READY'
  | 'RUNNING'
  | 'REVIEW'
  | 'TESTING'
  | 'APPROVED'
  | 'MERGED'
  | 'DONE'
  | 'BLOCKED'
  | 'FAILED'
  | 'RETRYING'
  | 'CANCELLED'

/** Inferred from the title/spec; shown as "inferred" in the inspector. */
export type TaskKind = 'task' | 'review' | 'test' | 'merge' | 'plan'

export type TaskRecord = {
  id: string
  runId: string
  parentId: string | null
  title: string
  displayName: string | null
  spec: string | null
  kind: TaskKind
  /** Raw Orca status: pending, ready, dispatched, completed, failed, blocked. */
  orcaStatus: string
  state: TaskState
  deps: string[]
  assigneeAgentId: string | null
  dispatchIds: string[]
  result: TaskResult | null
  createdAt: number | null
  completedAt: number | null
  retryCount: number
  gateIds: string[]
  version: number
}

export type TaskResult = {
  outcome: string | null
  message: string | null
  filesModified: string[]
  raw: string | null
}

export type RunRecord = {
  id: string
  objective: string
  legacy: boolean
  coordinatorHandle: string | null
  state: 'active' | 'completed' | 'failed' | 'idle'
  startedAt: number | null
  endedAt: number | null
  taskCount: number
  version: number
}

export type MessageRecord = {
  id: string
  runId: string | null
  fromHandle: string | null
  toHandle: string | null
  fromAgentId: string | null
  toAgentId: string | null
  type: string
  subject: string | null
  body: string | null
  taskId: string | null
  createdAt: number
}

export type GateRecord = {
  id: string
  taskId: string | null
  question: string | null
  status: string
  resolution: string | null
  createdAt: number | null
}

export type WorktreeRecord = {
  id: string
  name: string
  path: string
  branch: string | null
  project: string | null
  projectId: string | null
  hostId: string | null
  kind: 'worktree' | 'folder'
  status: string | null
  terminalCount: number | null
  lastActivityAt: number | null
  version: number
}

/** An Orca project (repository or folder) as `project.list` reports it. */
export type ProjectRecord = {
  id: string
  name: string
  path: string
  kind: 'git' | 'folder'
  hostId: string | null
  hidden: boolean
}

export type ToolCallRecord = {
  id: string
  agentId: string | null
  terminalId: string | null
  tool: string
  summary: string
  at: number
  phase: 'started' | 'finished'
}

export type AccountRecord = {
  id: string
  provider: string
  email: string | null
  label: string | null
  active: boolean
}

export type CommandAvailabilityMap = Record<string, { available: boolean; mode: 'direct' | 'coordinator' | 'unsupported'; reason: string | null }>

export type Capabilities = {
  hostMethods: Record<string, boolean>
  commands: CommandAvailabilityMap
  actAsCoordinator: boolean
  /** Experimental chat-session sending is on. */
  chatSend?: boolean
  /** The browser dashboard may run controls (setting); Orca's own panels always may. */
  dashboardControls?: boolean
  cliAvailable: boolean
  cliPath: string | null
  hooks: boolean
  dashboard: { enabled: boolean; url: string | null }
  apiMinor: number
  /** The person's home folder, so `~` in project rules can be resolved. */
  homeDir: string | null
}

export type FlowState = {
  seq: number
  generatedAt: number
  agents: Record<string, AgentRecord>
  tasks: Record<string, TaskRecord>
  runs: Record<string, RunRecord>
  messages: MessageRecord[]
  gates: Record<string, GateRecord>
  worktrees: Record<string, WorktreeRecord>
  toolCalls: ToolCallRecord[]
  accounts: Record<string, AccountRecord>
  projects: Record<string, ProjectRecord>
  capabilities: Capabilities
  labels: LabelConfig
}

/** Optional person-defined labels; never required for the graph to work. */
export type LabelConfig = {
  /** accountId or email → team name ("Team A"). */
  accountTeams: Record<string, string>
  /** agent kind, dispatch display name or model → role label ("Reviewer"). */
  agentRoles: Record<string, string>
  leadAccount: string | null
  /** Project box key → display name the person chose. */
  projectNames: Record<string, string>
  /** Project box key → color (#rrggbb). */
  projectColors: Record<string, string>
  /** Path pattern (glob, ~ allowed) → group name. Rules win over Orca's projects. */
  projectRules: Record<string, string>
}

export const EMPTY_LABELS: LabelConfig = { accountTeams: {}, agentRoles: {}, leadAccount: null, projectNames: {}, projectColors: {}, projectRules: {} }

export function emptyLabels(): LabelConfig {
  return { accountTeams: {}, agentRoles: {}, leadAccount: null, projectNames: {}, projectColors: {}, projectRules: {} }
}

export function emptyCapabilities(): Capabilities {
  return { hostMethods: {}, commands: {}, actAsCoordinator: false, cliAvailable: false, cliPath: null, hooks: false, dashboard: { enabled: false, url: null }, apiMinor: 0, homeDir: null }
}

export function emptyState(): FlowState {
  return {
    seq: 0,
    generatedAt: Date.now(),
    agents: {},
    tasks: {},
    runs: {},
    messages: [],
    gates: {},
    worktrees: {},
    toolCalls: [],
    accounts: {},
    projects: {},
    capabilities: emptyCapabilities(),
    // A fresh copy: a shared object would let one state's labels leak into another.
    labels: emptyLabels()
  }
}
