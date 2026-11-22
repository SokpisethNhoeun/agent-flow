import type { UpdateChecker } from '../update/update-check.ts'
import type { StarAnswer, StarPromptStore } from '../state/star-prompt.ts'
// Runs validated commands against real Orca operations. Each request id runs at most once;
// destructive commands need the UI's confirmation flag; results are reported as they happened.
import { mentionFor, type AttachmentStore, type AttachmentType } from './attachments.ts'
import { createHash } from 'node:crypto'
import { DESTRUCTIVE_COMMANDS, READ_ONLY_COMMANDS, validateCommand, ValidationError, type CommandKind, type CommandRequest, type CommandResponse } from '../../shared/commands.ts'
import type { AgentRecord, LabelConfig } from '../../shared/model.ts'
import { redact, stripAnsi } from '../../shared/redact.ts'
import type { WorkerContext } from '../context.ts'
import { inspectWorktree } from '../git/git-inspect.ts'
import type { Persistence } from '../state/persistence.ts'
import { commandAvailability } from './availability.ts'
import { coordinatorArgs, shellQuote } from './coordinator-commands.ts'
import { readWorkerOutput } from './transcript.ts'
import { chatSessionIdFromPaneKey } from '../runtime-rpc/chat-send.ts'
import { readClaudeImage, readClaudeTranscript } from './claude-transcript.ts'

export type RouterDeps = {
  ctx: WorkerContext
  persistence: Persistence
  ownTerminals: Set<string>
  settings: () => { actAsCoordinator: boolean; chatSend: boolean }
  /** Experimental: Orca runtime RPC send into a chat session. Injected so tests never touch a real socket. */
  sendChat?: (sessionId: string, text: string) => Promise<unknown>
  updateLabels: (labels: LabelConfig) => Promise<void>
  dashboardInfo: () => { enabled: boolean; url: string | null }
  refresh: () => void
  fullText: (key: string) => string | null
  /** Path of a Claude transcript for this agent, when one exists. */
  claudeTranscriptPath: (agent: AgentRecord) => Promise<string | null>
  /** Starts pushing changes of this transcript to views; true when it will. */
  watchOutput?: (agentId: string, path: string) => boolean
  /** Output without a file: views are told on the agent's status changes and tool calls instead. */
  noteOutputInterest?: (agentId: string) => void
  /** Images attached in the message box (agent.attach). */
  attachments?: AttachmentStore
  /** The occasional "star the project" prompt. */
  starPrompt?: StarPromptStore
  /** New-version checks and `orca plugin update`. */
  updates?: UpdateChecker
  /** The plugin's own `dashboardControls` setting (same switch as in Orca Settings). */
  setDashboardControls?: (enabled: boolean) => Promise<{ controls: boolean }>
  setDashboard: (enabled: boolean) => Promise<{ enabled: boolean; url: string | null }>
  /** Commands allowed from this caller (the dashboard without control rights gets read-only). */
}

const CACHE_LIMIT = 500
const OUTPUT_CACHE_MS = 2500
/** Base64 characters per image chunk; well under Orca's 1 MiB panel answer limit. */
const IMAGE_CHUNK = 600_000
const OUTPUT_BUDGET = 850 * 1024

export class CommandRouter {
  private results = new Map<string, Promise<CommandResponse>>()

  constructor(private readonly deps: RouterDeps) {}

  /** Entry point for every transport. `allowed` narrows what a caller may run. */
  handle(input: unknown, allowed: (kind: CommandKind) => boolean = () => true): Promise<CommandResponse> {
    let request: CommandRequest
    try {
      request = validateCommand(input)
    } catch (error) {
      return Promise.resolve(fail(error instanceof ValidationError ? 'invalid_params' : 'action_failed', (error as Error).message))
    }
    if (!allowed(request.kind)) return Promise.resolve(fail('not_permitted', 'This view may not run that command.'))
    const cached = this.results.get(request.requestId)
    if (cached) return cached
    const promise = this.execute(request)
    this.results.set(request.requestId, promise)
    if (this.results.size > CACHE_LIMIT) {
      const oldest = this.results.keys().next().value
      if (oldest !== undefined) this.results.delete(oldest)
    }
    return promise
  }

  private async execute(request: CommandRequest): Promise<CommandResponse> {
    const { ctx } = this.deps
    const availability = commandAvailability(request.kind, { hostHas: (m) => ctx.orca.host.has(m), cli: Boolean(ctx.cli.path), actAsCoordinator: this.deps.settings().actAsCoordinator })
    if (!availability.available) return fail('unsupported', availability.reason ?? 'Not supported by this Orca.')
    if (DESTRUCTIVE_COMMANDS.has(request.kind) && !request.confirmed) return fail('confirmation_required', 'Confirm this action first.')
    try {
      const response = await this.run(request)
      if (!READ_ONLY_COMMANDS.has(request.kind) && request.kind !== 'entity.detail') ctx.store.emit({
        ts: ctx.now(),
        kind: response.ok ? 'command.executed' : 'command.failed',
        source: 'command',
        entityId: String(request.params.agentId ?? request.params.taskId ?? request.params.terminalId ?? request.params.workspaceId ?? request.kind),
        summary: `${request.kind}: ${response.ok ? 'done' : response.error.message}`
      })
      // Reads change nothing in Orca, so they must not trigger a re-scan (the output view polls).
      if (response.ok && !READ_ONLY_COMMANDS.has(request.kind)) this.deps.refresh()
      return response
    } catch (error) {
      const err = error as Error & { code?: string }
      ctx.log(`command ${request.kind} failed: ${err.message}`)
      return fail(typeof err.code === 'string' ? err.code : 'action_failed', redact(err.message))
    }
  }

  private async run(request: CommandRequest): Promise<CommandResponse> {
    const { ctx } = this.deps
    const p = request.params as Record<string, string & string[] & Record<string, string>>
    const host = ctx.orca.host
    switch (request.kind) {
      case 'terminal.focus':
        return ok(await host.call('terminal.focus', { terminalId: p.terminalId }))
      case 'terminal.read': {
        const result = await host.call('terminal.read', { terminalId: p.terminalId, maxLines: 400 })
        return ok({ kind: 'lines', source: 'terminal', lines: result.lines.map((line) => redact(stripAnsi(line))), truncated: result.truncated })
      }
      case 'agent.readOutput':
        return p.before ? this.readEarlier(p.agentId, p.before) : this.readOutputSince(p.agentId, p.since)
      case 'agent.prompt':
        return this.prompt(p.agentId, p.text ?? '', (request.params.attachments as string[] | undefined) ?? [])
      case 'update.check':
        return this.deps.updates ? ok(await this.deps.updates.check(request.params.force === true)) : fail('unsupported', 'Update checks are not available here.')
      case 'update.run':
        return this.deps.updates ? ok(await this.deps.updates.update(this.deps.ctx.cli)) : fail('unsupported', 'Updating is not available here.')
      case 'star.visit':
        return this.deps.starPrompt ? ok(await this.deps.starPrompt.visit()) : ok({ show: false })
      case 'star.answer':
        await this.deps.starPrompt?.answer(p.answer as StarAnswer)
        return ok({ saved: true })
      case 'agent.attach': {
        if (!this.deps.attachments) return fail('unsupported', 'Attaching images is not available here.')
        const result = await this.deps.attachments.append(p.uploadId, p.mediaType as AttachmentType, p.chunk, Number(p.offset), request.params.done === true)
        return ok(result)
      }
      case 'agent.image':
        return this.image(p.agentId, p.ref, Number(p.offset ?? 0))
      case 'agent.launch': {
        const result = await host.call('agent.launch', { workspaceId: p.workspaceId, agent: p.agent, ...(p.prompt ? { prompt: p.prompt } : {}) })
        this.deps.ownTerminals.add(result.terminalId)
        return ok(result)
      }
      case 'agent.resume': {
        const result = await host.call('agent.resume', { workspaceId: p.workspaceId, agent: p.agent as never, sessionId: p.sessionId })
        this.deps.ownTerminals.add(result.terminalId)
        return ok(result)
      }
      case 'agent.stop':
        return this.stopAgent(p.agentId)
      case 'task.cancel':
        return this.cancelTask(p.taskId, p.runId)
      case 'task.create':
      case 'task.update':
      case 'task.retry':
      case 'task.dispatch':
      case 'gate.resolve':
      case 'message.send':
        return this.coordinatorCommand(request)
      case 'worktree.create': {
        const result = await host.call('workspace.create', {
          projectId: p.projectId,
          ...(p.name ? { name: p.name } : {}),
          ...(p.baseBranch ? { baseBranch: p.baseBranch } : {}),
          ...(p.agent ? { agent: p.agent } : {}),
          ...(p.prompt ? { prompt: p.prompt } : {})
        })
        if (result.terminalId) this.deps.ownTerminals.add(result.terminalId)
        return ok(result)
      }
      case 'worktree.open':
        return ok(await host.call('workspace.open', { workspaceId: p.workspaceId }))
      case 'worktree.inspect':
        return this.inspect(p.path)
      case 'model.change':
        return fail('unsupported', 'Orca has no API to change a running agent’s model or effort.')
      case 'labels.update': {
        const current = ctx.store.read().labels
        const next: LabelConfig = {
          accountTeams: (p.accountTeams as Record<string, string> | undefined) ?? current.accountTeams,
          agentRoles: (p.agentRoles as Record<string, string> | undefined) ?? current.agentRoles,
          leadAccount: (p.leadAccount as string | undefined) ?? current.leadAccount,
          projectNames: (p.projectNames as Record<string, string> | undefined) ?? current.projectNames ?? {},
          projectColors: sanitizeColors((p.projectColors as Record<string, string> | undefined) ?? current.projectColors ?? {}),
          projectRules: (p.projectRules as Record<string, string> | undefined) ?? current.projectRules ?? {}
        }
        await this.deps.updateLabels(next)
        return ok(next)
      }
      case 'history.list':
        return ok(await this.deps.persistence.listRuns())
      case 'history.load': {
        const record = await this.deps.persistence.loadRun(p.runId)
        return record ? ok(record) : fail('not_found', 'No saved history for that run.')
      }
      case 'viewer.ping':
        return ok({ alive: true })
      case 'dashboard.info':
        return ok(this.deps.dashboardInfo())
      case 'dashboard.controls':
        return this.deps.setDashboardControls ? ok(await this.deps.setDashboardControls(request.params.enabled === true)) : fail('unsupported', 'Not available.')
      case 'dashboard.enable':
        return ok(await this.deps.setDashboard(request.params.enabled === true))
      case 'entity.detail': {
        const text = this.deps.fullText(p.key)
        return text === null ? fail('not_found', 'Full text is no longer cached; it is refreshed on the next poll.') : ok({ text })
      }
    }
  }

  /** Several open views ask for the same output; share one read for a few seconds. */
  private outputCache = new Map<string, { at: number; promise: Promise<CommandResponse> }>()

  /** Live views poll every few seconds; when nothing changed, answer with a few bytes only. */
  /** The transcript changed: the next read must not get the short-lived cached answer. */
  invalidateOutput(agentId: string): void {
    this.outputCache.delete(agentId)
  }

  private async readOutputSince(agentId: string, since: string | undefined): Promise<CommandResponse> {
    const response = await this.readOutput(agentId)
    if (!since || !response.ok) return response
    const version = (response.result as { version?: string }).version
    return version === since ? ok({ unchanged: true, version }) : response
  }

  private readOutput(agentId: string): Promise<CommandResponse> {
    const now = Date.now()
    const cached = this.outputCache.get(agentId)
    if (cached && now - cached.at < OUTPUT_CACHE_MS) return cached.promise
    const promise = this.readOutputNow(agentId).then(fitOutput).then(withVersion)
    this.outputCache.set(agentId, { at: now, promise })
    if (this.outputCache.size > 50) this.outputCache.delete(this.outputCache.keys().next().value as string)
    return promise
  }

  /** Older messages of a Claude transcript, the batch before `before` (a message id). */
  private async readEarlier(agentId: string, before: string): Promise<CommandResponse> {
    const agent = this.deps.ctx.store.read().agents[agentId]
    if (!agent) return fail('not_found', 'That agent is no longer known.')
    const path = await this.deps.claudeTranscriptPath(agent)
    if (!path) return fail('unavailable', 'Earlier messages are available for Claude conversations only.')
    const output = await readClaudeTranscript(path, { beforeId: before })
    return output ? fitOutput(ok(output)) : fail('unavailable', 'Could not read the transcript.')
  }

  private async readOutputNow(agentId: string): Promise<CommandResponse> {
    const { ctx } = this.deps
    const agent = ctx.store.read().agents[agentId]
    if (!agent) return fail('not_found', 'That agent is no longer known.')
    // 1. Orchestration workers: Orca's own transcript / labelled output.
    if (agent.dispatchId && ctx.cli.path) {
      const output = await readWorkerOutput(ctx.cli, agent.dispatchId)
      if (output) {
        this.deps.noteOutputInterest?.(agentId)
        return ok({ ...output, events: Boolean(this.deps.noteOutputInterest) })
      }
    }
    // 2. Claude subagents and Claude sessions (chat or terminal): Claude Code's own transcript file.
    const transcript = await this.deps.claudeTranscriptPath(agent)
    if (transcript) {
      const output = await readClaudeTranscript(transcript)
      // `push`: the view hears about new messages and only needs a slow safety poll.
      if (output) return ok({ ...output, push: this.deps.watchOutput?.(agentId, transcript) ?? false })
    }
    // 3. Terminal output.
    if (agent.terminalId && ctx.orca.host.has('terminal.read')) {
      const result = await ctx.orca.host.call('terminal.read', { terminalId: agent.terminalId, maxLines: 400 })
      this.deps.noteOutputInterest?.(agentId)
      // `events`: status changes and tool calls announce new output; polling can be slower.
      return ok({ kind: 'lines', source: 'terminal', lines: result.lines.map((line) => redact(stripAnsi(line))), truncated: result.truncated, events: Boolean(this.deps.noteOutputInterest) })
    }
    return fail('unavailable', 'Orca exposes no output for this agent.')
  }

  /**
   * Sends a prompt where Orca allows it: typed into the agent's terminal, or as an orchestration
   * message to a worker (coordinator rules apply). Chat sessions and subagents have no API.
   */
  private async prompt(agentId: string, rawText: string, attachmentIds: string[] = []): Promise<CommandResponse> {
    const { ctx } = this.deps
    const agent = ctx.store.read().agents[agentId]
    if (!agent) return fail('not_found', 'That agent is no longer known.')
    if (!rawText.trim() && !attachmentIds.length) return fail('invalid_params', 'The message is empty.')
    if (agent.role === 'subagent') return fail('unsupported', 'A subagent only takes its brief from its parent. Send your message to the parent agent instead.')
    // Attached images: only files Agent Flow itself saved (by id), mentioned the way each route reads them.
    const paths: string[] = []
    for (const id of attachmentIds) {
      const path = this.deps.attachments?.pathFor(id)
      if (!path) return fail('not_found', 'An attached image is no longer available; attach it again.')
      paths.push(path)
    }
    const route = chatSessionIdFromPaneKey(agent.paneKey) && !agent.terminalId ? 'chat' : agent.agent === 'claude' || agent.agent === null ? 'claude-terminal' : 'other'
    const text = [rawText.trim(), ...paths.map((path) => mentionFor(path, route))].filter(Boolean).join(' ')
    if (agent.terminalId && ctx.orca.host.has('terminal.sendText')) {
      const result = await ctx.orca.host.call('terminal.sendText', { terminalId: agent.terminalId, text, enter: true })
      return result.accepted ? ok({ via: 'terminal', delivered: true }) : fail('action_failed', 'Orca did not accept the text for that terminal.')
    }
    const chatSession = chatSessionIdFromPaneKey(agent.paneKey)
    if (chatSession) {
      if (!this.deps.settings().chatSend || !this.deps.sendChat) return fail('unsupported', 'Sending into chat sessions is turned off in Agent Flow settings.')
      try {
        await this.deps.sendChat(chatSession, text)
        return ok({ via: 'chat-session', delivered: true })
      } catch (error) {
        const err = error as Error & { code?: string }
        return fail(err.code ?? 'action_failed', `Orca did not take the message: ${redact(err.message)}`)
      }
    }
    if (agent.dispatchId && agent.runId) {
      const response = await this.coordinatorCommand({ requestId: 'internal-prompt', kind: 'message.send', params: { runId: agent.runId, to: `dispatch:${agent.dispatchId}`, subject: 'Message from Agent Flow', body: text } })
      return response.ok ? ok({ via: 'orchestration-message', delivered: true }) : response
    }
    return fail('unsupported', 'Orca has no API for plugins to send a message into a chat session. Open the session in Orca and type there.')
  }

  /** One image from a Claude transcript, in chunks that fit Orca's panel answer limit. */
  private async image(agentId: string, ref: string, offset: number): Promise<CommandResponse> {
    const agent = this.deps.ctx.store.read().agents[agentId]
    if (!agent) return fail('not_found', 'That agent is no longer known.')
    const path = await this.deps.claudeTranscriptPath(agent)
    if (!path) return fail('unavailable', 'No transcript with images for this agent.')
    const image = await readClaudeImage(path, ref)
    if (!image) return fail('not_found', 'That image is no longer in the transcript.')
    const chunk = image.data.slice(offset, offset + IMAGE_CHUNK)
    return ok({ mediaType: image.mediaType, total: image.data.length, offset, chunk })
  }

  private async stopAgent(agentId: string): Promise<CommandResponse> {
    const { ctx } = this.deps
    const agent = ctx.store.read().agents[agentId]
    if (!agent) return fail('not_found', 'That agent is no longer known.')
    if (agent.dispatchId) {
      const result = await ctx.cli.run(['orchestration', 'worker-stop', '--dispatch', agent.dispatchId])
      return result.ok ? ok(result.result) : fail(result.code, result.message)
    }
    if (agent.terminalId && this.deps.ownTerminals.has(agent.terminalId) && ctx.orca.host.has('terminal.close')) {
      return ok(await ctx.orca.host.call('terminal.close', { terminalId: agent.terminalId }))
    }
    return fail('not_permitted', 'Orca lets plugins stop orchestration workers and terminals Agent Flow opened. Stop this agent from its own tab.')
  }

  private async cancelTask(taskId: string, runId: string): Promise<CommandResponse> {
    const { ctx } = this.deps
    const task = ctx.store.read().tasks[taskId]
    if (!task || task.runId !== runId) return fail('not_found', 'That task is not in this run.')
    const live = task.dispatchIds.map((id) => ctx.store.read().agents[`dispatch:${id}`]).filter((agent) => agent?.live)
    const stopped: string[] = []
    for (const agent of live) {
      const result = await ctx.cli.run(['orchestration', 'worker-stop', '--dispatch', agent!.dispatchId!])
      if (!result.ok) return fail(result.code, `Could not stop ${agent!.title ?? agent!.dispatchId}: ${result.message}`)
      stopped.push(agent!.dispatchId!)
    }
    // Orca: "To cancel a Task, stop its worker, then set --status failed --result cancelled".
    const update = await this.coordinatorCommand({ requestId: 'internal', kind: 'task.update', params: { taskId, runId, status: 'failed', result: 'cancelled' } })
    if (update.ok) return ok({ stopped, marked: true })
    return { ok: false, error: { code: update.error.code, message: `Stopped ${stopped.length} worker(s). ${update.error.message}` }, manual: update.manual }
  }

  private async coordinatorCommand(request: CommandRequest): Promise<CommandResponse> {
    const { ctx } = this.deps
    const runId = String(request.params.runId ?? '')
    const run = runId ? ctx.store.read().runs[runId] : undefined
    const args = coordinatorArgs(request, ctx.store.read())
    if (!args) return fail('invalid_params', 'That command needs a known run and task.')
    const display = `orca ${args.map(shellQuote).join(' ')}`
    if (!this.deps.settings().actAsCoordinator || !run?.coordinatorHandle) {
      const reason = run?.coordinatorHandle
        ? 'Orca only lets a Run’s coordinator do this. Run this in the coordinator, or turn on “Act as coordinator” in Agent Flow settings.'
        : 'Orca only lets a Run’s coordinator do this. This Run’s coordinator has no terminal handle (it is a chat session, or Orca did not record one), so paste this command into the coordinator.'
      return { ok: false, error: { code: 'coordinator_required', message: reason }, manual: { command: display, reason } }
    }
    // One argv element, like every other value: a handle can never be read as another flag.
    const result = await ctx.cli.run([...args, `--from=${run.coordinatorHandle}`], { timeoutMs: 90000 })
    return result.ok ? ok(result.result) : { ok: false, error: { code: result.code, message: result.message }, manual: { command: display, reason: result.message } }
  }

  private async inspect(path: string): Promise<CommandResponse> {
    const state = this.deps.ctx.store.read()
    const known = Object.values(state.worktrees).some((w) => w.path === path) || Object.values(state.agents).some((a) => a.worktreePath === path)
    if (!known) return fail('not_permitted', 'Agent Flow only inspects worktrees Orca knows about.')
    return ok(await inspectWorktree(path))
  }
}

/** Colors end up in CSS: only #rgb / #rrggbb survive. */
export function sanitizeColors(colors: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(colors).filter(([, v]) => /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(v)))
}

/** Keeps a conversation answer under Orca's 1 MiB panel limit by dropping the oldest messages. */
export function fitOutput(response: CommandResponse, budget = OUTPUT_BUDGET): CommandResponse {
  if (!response.ok) return response
  const result = response.result as { kind?: string; messages?: unknown[]; truncated?: boolean }
  if (result?.kind !== 'conversation' || !Array.isArray(result.messages)) return response
  let messages = result.messages
  while (messages.length > 1 && Buffer.byteLength(JSON.stringify({ ...result, messages })) > budget) messages = messages.slice(Math.ceil(messages.length / 8))
  return messages === result.messages ? response : { ok: true, result: { ...result, messages, truncated: true } }
}

/** Adds a short content hash, so a view can ask "anything new since this version?". */
export function withVersion(response: CommandResponse): CommandResponse {
  if (!response.ok || !response.result || typeof response.result !== 'object') return response
  const version = createHash('sha1').update(JSON.stringify(response.result)).digest('hex').slice(0, 16)
  return { ok: true, result: { ...(response.result as object), version } }
}

function ok(result: unknown): CommandResponse {
  return { ok: true, result }
}

function fail(code: string, message: string): CommandResponse {
  return { ok: false, error: { code, message } }
}
