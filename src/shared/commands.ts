// Command contract between every UI and the worker. The worker re-validates every field;
// UIs use the same validators to disable invalid actions early.

export type CommandKind =
  | 'terminal.focus'
  | 'terminal.read'
  | 'agent.launch'
  | 'agent.resume'
  | 'agent.stop'
  | 'agent.readOutput'
  | 'task.create'
  | 'task.update'
  | 'task.cancel'
  | 'task.retry'
  | 'task.dispatch'
  | 'gate.resolve'
  | 'worktree.create'
  | 'worktree.open'
  | 'worktree.inspect'
  | 'message.send'
  | 'model.change'
  | 'labels.update'
  | 'history.list'
  | 'history.load'
  | 'dashboard.info'
  | 'entity.detail'
  | 'dashboard.enable'
  | 'dashboard.controls'
  | 'agent.prompt'
  | 'agent.image'
  | 'viewer.ping'

export type CommandRequest = {
  requestId: string
  kind: CommandKind
  params: Record<string, unknown>
  /** Set by the UI only after a confirmation dialog for destructive commands. */
  confirmed?: boolean
}

export type CommandError = { code: string; message: string }

/** For coordinator-only orchestration actions: the exact CLI command the coordinator can run. */
export type ManualStep = { command: string; reason: string }

export type CommandResponse = { ok: true; result: unknown } | { ok: false; error: CommandError; manual?: ManualStep }

/** How a command reaches Orca, reported to the UI so it can enable/disable controls honestly. */
export type CommandAvailability = {
  available: boolean
  mode: 'direct' | 'coordinator' | 'unsupported'
  reason: string | null
}

export const DESTRUCTIVE_COMMANDS: ReadonlySet<CommandKind> = new Set(['agent.stop', 'task.cancel'])

export const ALL_COMMANDS: readonly CommandKind[] = [
  'terminal.focus', 'terminal.read', 'agent.launch', 'agent.resume', 'agent.stop', 'agent.readOutput',
  'task.create', 'task.update', 'task.cancel', 'task.retry', 'task.dispatch', 'gate.resolve',
  'worktree.create', 'worktree.open', 'worktree.inspect', 'message.send', 'model.change',
  'labels.update', 'history.list', 'history.load', 'dashboard.info', 'entity.detail', 'dashboard.enable', 'dashboard.controls', 'agent.prompt', 'agent.image', 'viewer.ping'
]

/** Commands that only read state; safe for the dashboard without control rights. */
export const READ_ONLY_COMMANDS: ReadonlySet<CommandKind> = new Set([
  'terminal.read', 'agent.readOutput', 'worktree.inspect', 'history.list', 'history.load', 'dashboard.info', 'entity.detail', 'agent.image', 'viewer.ping'
])

export class ValidationError extends Error {
  code = 'invalid_params'
}

type FieldSpec =
  | { type: 'string'; required?: boolean; max?: number; pattern?: RegExp; oneOf?: readonly string[] }
  | { type: 'boolean'; required?: boolean }
  | { type: 'stringArray'; required?: boolean; maxItems?: number; pattern?: RegExp }
  | { type: 'record'; required?: boolean; maxKeys?: number }

const ID = /^[A-Za-z0-9_:.\-/@]{1,400}$/
const AGENT = /^[a-z0-9][a-z0-9-]{0,40}$/
const MODEL = /^[A-Za-z0-9_.:@/\-[\]]{1,120}$/
const EFFORT = /^[a-z]{1,20}$/
const TASK_STATUS = ['pending', 'ready', 'dispatched', 'completed', 'failed', 'blocked'] as const
export const WORKTREE_MODES = ['new-child', 'current'] as const

export const COMMAND_PARAMS: Record<CommandKind, Record<string, FieldSpec>> = {
  'terminal.focus': { terminalId: { type: 'string', required: true, pattern: ID } },
  'terminal.read': { terminalId: { type: 'string', required: true, pattern: ID } },
  'agent.launch': {
    workspaceId: { type: 'string', required: true, pattern: ID },
    agent: { type: 'string', required: true, pattern: AGENT },
    prompt: { type: 'string', max: 20000 }
  },
  'agent.resume': {
    workspaceId: { type: 'string', required: true, pattern: ID },
    agent: { type: 'string', required: true, pattern: AGENT },
    sessionId: { type: 'string', required: true, pattern: ID }
  },
  'agent.stop': { agentId: { type: 'string', required: true, pattern: ID } },
  'agent.readOutput': {
    agentId: { type: 'string', required: true, pattern: ID },
    before: { type: 'string', max: 200, pattern: /^[A-Za-z0-9_.:-]{1,200}$/ },
    /** The version the view already shows: an unchanged answer is then sent as `{ unchanged: true }`. */
    since: { type: 'string', max: 64, pattern: /^[a-f0-9]{8,64}$/ }
  },
  'task.create': {
    runId: { type: 'string', required: true, pattern: ID },
    title: { type: 'string', required: true, max: 200 },
    spec: { type: 'string', required: true, max: 60000 },
    deps: { type: 'stringArray', maxItems: 50, pattern: ID },
    parentId: { type: 'string', pattern: ID }
  },
  'task.update': {
    taskId: { type: 'string', required: true, pattern: ID },
    runId: { type: 'string', required: true, pattern: ID },
    status: { type: 'string', required: true, oneOf: TASK_STATUS },
    result: { type: 'string', max: 4000 }
  },
  'task.cancel': {
    taskId: { type: 'string', required: true, pattern: ID },
    runId: { type: 'string', required: true, pattern: ID }
  },
  'task.retry': {
    taskId: { type: 'string', required: true, pattern: ID },
    runId: { type: 'string', required: true, pattern: ID },
    agent: { type: 'string', pattern: AGENT },
    model: { type: 'string', pattern: MODEL },
    effort: { type: 'string', pattern: EFFORT },
    worktree: { type: 'string', oneOf: WORKTREE_MODES }
  },
  'task.dispatch': {
    taskId: { type: 'string', required: true, pattern: ID },
    runId: { type: 'string', required: true, pattern: ID },
    agent: { type: 'string', pattern: AGENT },
    model: { type: 'string', pattern: MODEL },
    effort: { type: 'string', pattern: EFFORT },
    worktree: { type: 'string', oneOf: WORKTREE_MODES }
  },
  'gate.resolve': {
    gateId: { type: 'string', required: true, pattern: ID },
    runId: { type: 'string', required: true, pattern: ID },
    resolution: { type: 'string', required: true, max: 4000 }
  },
  'worktree.create': {
    projectId: { type: 'string', required: true, pattern: ID },
    name: { type: 'string', max: 120 },
    baseBranch: { type: 'string', max: 200 },
    agent: { type: 'string', pattern: AGENT },
    prompt: { type: 'string', max: 20000 }
  },
  'worktree.open': { workspaceId: { type: 'string', required: true, pattern: ID } },
  'worktree.inspect': { path: { type: 'string', required: true, max: 1000 } },
  'message.send': {
    runId: { type: 'string', required: true, pattern: ID },
    to: { type: 'string', required: true, pattern: ID },
    subject: { type: 'string', required: true, max: 200 },
    body: { type: 'string', required: true, max: 20000 }
  },
  'model.change': {
    agentId: { type: 'string', required: true, pattern: ID },
    model: { type: 'string', pattern: MODEL },
    effort: { type: 'string', pattern: EFFORT }
  },
  'labels.update': {
    accountTeams: { type: 'record', maxKeys: 100 },
    agentRoles: { type: 'record', maxKeys: 100 },
    projectNames: { type: 'record', maxKeys: 200 },
    projectColors: { type: 'record', maxKeys: 200 },
    projectRules: { type: 'record', maxKeys: 100 },
    leadAccount: { type: 'string', max: 300 }
  },
  'history.list': {},
  'history.load': { runId: { type: 'string', required: true, pattern: ID } },
  'dashboard.info': {},
  /** A visible UI says it is still open, so the worker keeps its fast pace. */
  'viewer.ping': {},
  'agent.image': { agentId: { type: 'string', required: true, pattern: ID }, ref: { type: 'string', required: true, max: 200, pattern: /^[A-Za-z0-9_.:-]{1,120}\|\d{1,4}(\|\d{1,4})?$/ }, offset: { type: 'string', pattern: /^\d{1,9}$/ } },
  'agent.prompt': { agentId: { type: 'string', required: true, pattern: ID }, text: { type: 'string', required: true, max: 20000 } },
  'dashboard.controls': { enabled: { type: 'boolean', required: true } },
  'dashboard.enable': { enabled: { type: 'boolean', required: true } },
  'entity.detail': { key: { type: 'string', required: true, max: 420, pattern: /^(task|message):[A-Za-z0-9_:.\-]{1,400}$/ } }
}

/** Strict: unknown fields are refused, like Orca's own host API. */
export function validateCommand(input: unknown): CommandRequest {
  if (!isRecord(input)) throw new ValidationError('Command must be an object.')
  const { requestId, kind, params, confirmed } = input
  if (typeof requestId !== 'string' || !/^[A-Za-z0-9_-]{8,80}$/.test(requestId)) throw new ValidationError('requestId is missing or malformed.')
  if (typeof kind !== 'string' || !(ALL_COMMANDS as readonly string[]).includes(kind)) throw new ValidationError(`Unknown command "${String(kind)}".`)
  if (confirmed !== undefined && typeof confirmed !== 'boolean') throw new ValidationError('confirmed must be a boolean.')
  const spec = COMMAND_PARAMS[kind as CommandKind]
  const raw = params === undefined ? {} : params
  if (!isRecord(raw)) throw new ValidationError('params must be an object.')
  for (const key of Object.keys(raw)) if (!Object.hasOwn(spec, key)) throw new ValidationError(`Unknown field "${key}" for ${kind}.`)
  const clean: Record<string, unknown> = {}
  for (const [key, field] of Object.entries(spec)) {
    const value = raw[key]
    if (value === undefined || value === null || value === '') {
      if (field.required) throw new ValidationError(`${key} is required for ${kind}.`)
      continue
    }
    clean[key] = checkField(kind, key, field, value)
  }
  return { requestId, kind: kind as CommandKind, params: clean, confirmed: confirmed === true }
}

function checkField(kind: string, key: string, field: FieldSpec, value: unknown): unknown {
  const where = `${key} for ${kind}`
  switch (field.type) {
    case 'string': {
      if (typeof value !== 'string') throw new ValidationError(`${where} must be a string.`)
      if (field.max !== undefined && value.length > field.max) throw new ValidationError(`${where} is longer than ${field.max} characters.`)
      if (field.pattern && !field.pattern.test(value)) throw new ValidationError(`${where} has characters that are not allowed.`)
      if (field.oneOf && !field.oneOf.includes(value)) throw new ValidationError(`${where} must be one of ${field.oneOf.join(', ')}.`)
      return value
    }
    case 'boolean':
      if (typeof value !== 'boolean') throw new ValidationError(`${where} must be true or false.`)
      return value
    case 'stringArray': {
      if (!Array.isArray(value)) throw new ValidationError(`${where} must be a list.`)
      if (field.maxItems !== undefined && value.length > field.maxItems) throw new ValidationError(`${where} has too many items.`)
      for (const item of value) {
        if (typeof item !== 'string' || (field.pattern && !field.pattern.test(item))) throw new ValidationError(`${where} has an invalid item.`)
      }
      return [...new Set(value as string[])]
    }
    case 'record': {
      if (!isRecord(value)) throw new ValidationError(`${where} must be an object.`)
      const entries = Object.entries(value)
      if (field.maxKeys !== undefined && entries.length > field.maxKeys) throw new ValidationError(`${where} has too many entries.`)
      const out: Record<string, string> = {}
      for (const [k, v] of entries) {
        if (typeof v !== 'string' || k.length > 300 || v.length > 120) throw new ValidationError(`${where} entries must be short strings.`)
        out[k] = v
      }
      return out
    }
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function newRequestId(): string {
  const bytes = new Uint8Array(12)
  globalThis.crypto.getRandomValues(bytes)
  return 'req_' + Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}
