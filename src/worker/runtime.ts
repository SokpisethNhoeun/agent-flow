// Wires adapters, store, persistence, commands and transports, and paces the polling.
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'
import type { OrcaWorkerApi } from 'orca/worker'
import { ALL_COMMANDS } from '../shared/commands.ts'
import { EMPTY_LABELS, type LabelConfig } from '../shared/model.ts'
import { AccountsAdapter } from './adapters/accounts-adapter.ts'
import { AgentsAdapter } from './adapters/agents-adapter.ts'
import { OrchestrationAdapter } from './adapters/orchestration-adapter.ts'
import { SessionsAdapter } from './adapters/sessions-adapter.ts'
import { SubagentAdapter } from './adapters/subagent-adapter.ts'
import { SubagentFilesAdapter } from './adapters/subagent-files-adapter.ts'
import { SessionModelAdapter } from './adapters/session-model-adapter.ts'
import { createCliRunner, resolveCliPath } from './cli/orca-cli.ts'
import { commandAvailability } from './commands/availability.ts'
import { CommandRouter } from './commands/router.ts'
import type { WorkerContext } from './context.ts'
import { loadOrCreateToken, rotateToken as rotateDashboardToken } from './dashboard/auth.ts'
import { DashboardServer } from './dashboard/server.ts'
import { HistoryRecorder } from './state/history-recorder.ts'
import { repoRootOf } from './git/repo-root.ts'
import { sendChatMessage } from './runtime-rpc/chat-send.ts'
import { IdentityIndex } from './state/identity-index.ts'
import { mergeDuplicatesOf } from './state/merge-agents.ts'
import { Persistence, stateDir } from './state/persistence.ts'
import { FlowStore } from './state/store.ts'
import { ViewerTracker } from './state/viewers.ts'
import { OutputWatcher } from './commands/output-watcher.ts'
import { AttachmentStore, attachmentsRoot } from './commands/attachments.ts'
import { StarPromptStore } from './state/star-prompt.ts'
import { UpdateChecker } from './update/update-check.ts'
import { connectPanels } from './transport/panel-bridge.ts'

type Settings = {
  dashboardEnabled: boolean
  dashboardPort: number
  dashboardControls: boolean
  actAsCoordinator: boolean
  cliPath: string
  chatSend: boolean
  checkUpdates: boolean
}

/** Everything on by default (the manifest's defaults match); each setting can be turned off in Orca. */
const DEFAULT_SETTINGS: Settings = { dashboardEnabled: true, dashboardPort: 4790, dashboardControls: true, actAsCoordinator: true, cliPath: '', chatSend: true, checkUpdates: true }
/** Start attempts after a failure: 2 s, 4 s, 8 s, 16 s, 32 s. */
const DASHBOARD_RETRIES = 5
/** How often state is saved for crash recovery (only when something changed). */
const PERSIST_MS = 12_000
const SUBAGENT_ORPHAN_MS = 5 * 60 * 1000
const SUBAGENT_RETENTION_MS = 24 * 60 * 60 * 1000
const STANDALONE_RETENTION_MS = 7 * 24 * 60 * 60 * 1000
const HOST_METHODS = ['workspace.list', 'agents.list', 'agent.listSessions', 'terminal.read', 'terminal.focus', 'terminal.close', 'terminal.sendText', 'agent.launch', 'agent.resume', 'workspace.create', 'workspace.open', 'statusBar.update']

export class AgentFlowRuntime {
  private store = new FlowStore()
  private identity = new IdentityIndex()
  private persistence = new Persistence()
  private viewers = new ViewerTracker(Date.now)
  private outputWatcher = new OutputWatcher()
  private settings: Settings = DEFAULT_SETTINGS
  private ownTerminals = new Set<string>()
  /** One pending timer per named loop, so nothing accumulates and stop() clears everything. */
  private timers = new Map<string, ReturnType<typeof setTimeout>>()
  private dashboardOp: Promise<void> = Promise.resolve()
  private disposers: (() => void)[] = []
  private dashboard: DashboardServer | null = null
  private dashboardRetries = 0
  private ctx!: WorkerContext
  private agents!: AgentsAdapter
  private subagents!: SubagentAdapter
  private orchestration!: OrchestrationAdapter
  private accounts!: AccountsAdapter
  private sessions!: SessionsAdapter
  private subagentFiles!: SubagentFilesAdapter
  private sessionModels!: SessionModelAdapter
  private router!: CommandRouter
  private history!: HistoryRecorder
  private persistedSeq = -1
  private statusKey = ''
  private stopped = false

  constructor(private readonly orca: OrcaWorkerApi) {}

  async start(): Promise<void> {
    const log = (message: string) => this.orca.log(`[agent-flow] ${message}`)
    this.settings = await this.readSettings()
    const cli = createCliRunner(await resolveCliPath(this.settings.cliPath || null))
    if (!cli.path) log('orca CLI not found; orchestration data and controls are off')
    this.ctx = { orca: this.orca, store: this.store, cli, identity: this.identity, now: Date.now, log }

    await this.persistence.init().catch((error) => log(`state folder: ${(error as Error).message}`))
    const saved = await this.persistence.loadSnapshot()
    if (saved) {
      this.store.restore(saved)
      // Older versions could store one session twice; keep the most recently seen record.
      const bySession = new Map<string, string>()
      for (const agent of Object.values(this.store.read().agents).sort((a, b) => b.lastSeenAt - a.lastSeenAt)) {
        if (!agent.sessionId || agent.role === 'subagent') continue
        if (bySession.has(agent.sessionId)) this.store.removeAgent(agent.id)
        else bySession.set(agent.sessionId, agent.id)
      }
      // Re-link restored agents so live events land on the same node instead of a duplicate.
      for (const agent of Object.values(this.store.read().agents)) {
        this.identity.link(agent.id, { terminalId: agent.terminalId, paneKey: agent.paneKey, sessionId: agent.sessionId, terminalHandle: agent.terminalHandle })
      }
      for (const agent of Object.values(this.store.read().agents)) if (agent.dispatchId) mergeDuplicatesOf(this.store, this.identity, agent.id)
    }
    await this.loadLabels()

    this.agents = new AgentsAdapter(this.ctx)
    this.subagents = new SubagentAdapter(this.ctx)
    this.orchestration = new OrchestrationAdapter(this.ctx)
    this.accounts = new AccountsAdapter(this.ctx)
    this.sessions = new SessionsAdapter(this.ctx)
    this.subagentFiles = new SubagentFilesAdapter(this.ctx, () => this.accounts.claudeHomes())
    this.sessionModels = new SessionModelAdapter(this.ctx, this.subagentFiles, () => this.accounts.codexHomes())
    this.history = new HistoryRecorder(this.store, this.persistence, log)
    this.router = new CommandRouter({
      ctx: this.ctx,
      persistence: this.persistence,
      ownTerminals: this.ownTerminals,
      settings: () => ({ actAsCoordinator: this.settings.actAsCoordinator, chatSend: this.settings.chatSend }),
      sendChat: (sessionId, text) => sendChatMessage(sessionId, text),
      updateLabels: (labels) => this.saveLabels(labels),
      dashboardInfo: () => ({ enabled: Boolean(this.dashboard), url: this.dashboard?.url ?? null }),
      refresh: () => this.kick(),
      fullText: (key) => this.orchestration.fullTextFor(key),
      claudeTranscriptPath: (agent) => this.subagentFiles.transcriptPathFor(agent),
      watchOutput: (agentId, path) => this.outputWatcher.track(agentId, path),
      noteOutputInterest: (agentId) => this.outputWatcher.noteInterest(agentId),
      attachments: new AttachmentStore(attachmentsRoot(stateDir())),
      starPrompt: new StarPromptStore(stateDir()),
      // The plugin folder is one level above dist/worker.mjs.
      updates: new UpdateChecker(fileURLToPath(new URL('..', import.meta.url)), () => this.settings.checkUpdates),
      setDashboardControls: async (enabled) => {
        await this.orca.settings.set('dashboardControls', enabled)
        this.settings = await this.readSettings()
        this.publishCapabilities()
        return { controls: this.settings.dashboardControls }
      },
      setDashboard: async (enabled) => {
        // The plugin's own setting; Orca's Settings page shows the same switch.
        await this.orca.settings.set('dashboardEnabled', enabled)
        this.settings = await this.readSettings()
        await this.syncDashboard(enabled)
        return { enabled: Boolean(this.dashboard), url: this.dashboard?.url ?? null }
      }
    })

    this.disposers.push(this.outputWatcher.subscribe((agentId) => this.router.invalidateOutput(agentId)))
    // Agents without a transcript file: a status change or a tool call usually means new output.
    // Only real changes count: a record also changes when just its last-seen time moves.
    const outputSignature = new Map<string, string>()
    this.disposers.push(
      this.store.subscribe((delta) => {
        for (const patch of delta.patches) {
          if (patch.entity === 'agent' && patch.value) {
            const v = patch.value
            const signature = `${v.state}|${v.live}|${v.outcome}|${v.messageCount}|${v.tokens}|${v.stateSince}`
            if (outputSignature.get(v.id) === signature) continue
            outputSignature.set(v.id, signature)
            if (outputSignature.size > 2000) outputSignature.delete(outputSignature.keys().next().value!)
            this.outputWatcher.poke(v.id)
          } else if (patch.entity === 'toolCall' && patch.value.agentId) this.outputWatcher.poke(patch.value.agentId)
        }
      })
    )
    this.subscribeRuntime()
    this.disposers.push(
      connectPanels(this.orca.panels, {
        snapshot: () => {
          this.seen()
          return this.store.snapshot()
        },
        subscribe: (listener) => this.store.subscribe(listener),
        subscribeOutput: (listener) => this.outputWatcher.subscribe(listener),
        command: (input) => {
          this.seen()
          return this.router.handle(input)
        },
        log
      })
    )
    this.disposers.push(this.orca.settings.onDidChange(() => void this.onSettingsChanged()).dispose)
    this.disposers.push(this.orca.commands.register('agent-flow.showPanel', () => this.showPanel()).dispose)
    this.disposers.push(
      this.orca.commands.register('agent-flow.dashboardLink', () =>
        this.dashboard?.url
          ? `Open in your browser (keep the link private): ${this.dashboard.url}`
          : 'The browser dashboard is off. Turn on “Browser dashboard” under Agent Flow in Orca Settings.'
      ).dispose
    )
    this.publishCapabilities()
    // Do not hold up activation (Orca has a worker-ready timeout): first pass runs in the background.
    void this.initialPass()
  }

  private async initialPass(): Promise<void> {
    await this.syncDashboard(false)
    await this.agents.scan()
    await this.accounts.refresh()
    await this.orchestration.poll()
    await this.sessions.refresh()
    await this.subagentFiles.scan()
    await this.resolveRepoRoots()
    await this.sessionModels.refresh()
    this.accounts.applyToAgents()
    if (this.stopped) return
    // Fast while someone is looking; slow when nobody is (Orca's own events still trigger scans).
    const pace = (watched: number, idle: number) => () => this.viewers.pace(watched, idle)
    this.loop('orchestration', async () => {
      await this.orchestration.poll()
      this.accounts.applyToAgents()
    }, () => (this.orchestration.hasActiveWork ? this.viewers.pace(1500, 5000) : this.viewers.pace(6000, 30000)))
    this.loop('agents', () => this.agents.scan(), pace(10000, 60000))
    this.loop('accounts', async () => {
      await this.accounts.refresh()
      await this.sessions.refresh()
    }, pace(20000, 120000))
    this.loop('subagent-files', async () => {
      await this.subagentFiles.scan()
      await this.sessionModels.refresh()
    }, pace(5000, 30000))
    this.loop('repo-roots', () => this.resolveRepoRoots(), pace(15000, 120000))
    this.loop('persist', async () => {
      this.prune()
      await this.persist()
    }, () => PERSIST_MS)
    this.loop('status-bar', async () => this.updateStatusBar(), () => 3000)
  }

  async stop(): Promise<void> {
    this.stopped = true
    for (const timer of this.timers.values()) clearTimeout(timer)
    this.timers.clear()
    await this.dashboardOp.catch(() => undefined)
    for (const dispose of this.disposers.splice(0)) {
      try {
        dispose()
      } catch {
        // keep disposing
      }
    }
    await this.dashboard?.stop()
    this.outputWatcher.dispose()
    await this.persist(true)
    this.store.dispose()
  }

  private subscribeRuntime(): void {
    const { events, hooks } = this.orca
    this.disposers.push(events.on('agent.status.changed', (event) => this.agents.onStatus(event)).dispose)
    this.disposers.push(events.on('workspace.created', () => void this.agents.scan()).dispose)
    this.disposers.push(events.on('workspace.removed', () => void this.agents.scan()).dispose)
    this.disposers.push(events.on('workspace.changed', () => void this.agents.scan()).dispose)
    // Observe-only hooks: return nothing so Orca carries on without waiting on us.
    this.disposers.push(
      hooks.on('agent.tool.before', (event) => {
        try {
          this.subagents.onToolBefore(event)
        } catch (error) {
          this.ctx.log(`tool.before: ${(error as Error).message}`)
        }
      }).dispose
    )
    this.disposers.push(
      hooks.on('agent.tool.after', (event) => {
        try {
          this.subagents.onToolAfter(event)
        } catch (error) {
          this.ctx.log(`tool.after: ${(error as Error).message}`)
        }
      }).dispose
    )
    this.disposers.push(
      hooks.on('agent.launch.before', (event) => {
        try {
          this.accounts.onLaunch(event)
        } catch (error) {
          this.ctx.log(`launch.before: ${(error as Error).message}`)
        }
      }).dispose
    )
  }

  private loop(name: string, task: () => Promise<void>, interval: () => number): void {
    const tick = async () => {
      this.timers.delete(name)
      if (this.stopped) return
      try {
        await task()
      } catch (error) {
        this.ctx.log(`${name} failed: ${(error as Error).message}`)
      }
      if (!this.stopped) this.timers.set(name, setTimeout(tick, interval()))
    }
    this.timers.set(name, setTimeout(tick, interval()))
  }

  /** A one-shot timer that stop() also clears; re-scheduling the same name replaces it. */
  private once(name: string, ms: number, task: () => Promise<void>): void {
    const existing = this.timers.get(name)
    if (existing) clearTimeout(existing)
    this.timers.set(
      name,
      setTimeout(() => {
        this.timers.delete(name)
        if (!this.stopped) void task().catch((error) => this.ctx.log(`${name} failed: ${(error as Error).message}`))
      }, ms)
    )
  }

  /** Which repository each agent's worktree belongs to, for exact project boxes. */
  private async resolveRepoRoots(): Promise<void> {
    for (const agent of Object.values(this.store.read().agents)) {
      if (!agent.worktreePath || agent.repoRoot !== undefined) continue
      const repoRoot = await repoRootOf(agent.worktreePath)
      const current = this.store.read().agents[agent.id]
      if (current) this.store.upsertAgent(agent.id, current.lastSeenAt, { repoRoot }, () => current)
    }
  }

  /** Bounded memory: drop long-finished subagents and standalone agents (runs keep theirs in history). */
  private prune(): void {
    const now = Date.now()
    for (const agent of Object.values(this.store.read().agents)) {
      if (agent.live) {
        // A subagent cannot outlive its parent; hooks can miss the end (interrupt, crash).
        const parent = agent.role === 'subagent' && agent.parentId ? this.store.read().agents[agent.parentId] : undefined
        const orphaned = agent.role === 'subagent' && (!parent || !parent.live) && now - agent.lastSeenAt > SUBAGENT_ORPHAN_MS
        if (orphaned) this.store.upsertAgent(agent.id, now, { live: false, state: 'unknown', evidence: ['host-event'] }, () => agent)
        continue
      }
      const age = now - agent.lastSeenAt
      const stale = (agent.role === 'subagent' && age > SUBAGENT_RETENTION_MS) || (agent.role === 'agent' && !agent.runId && age > STANDALONE_RETENTION_MS)
      if (stale) {
        this.store.removeAgent(agent.id)
        this.identity.unlinkAgent(agent.id)
      }
    }
  }

  /** After a command, look again soon so its effect shows up quickly. */
  /** A panel or the dashboard asked for something. After a quiet stretch, catch up at once. */
  private seen(): void {
    if (!this.viewers.touch() || this.stopped) return
    this.kick()
    this.once('wake-subagents', 800, async () => {
      await this.subagentFiles.scan()
      await this.sessionModels.refresh()
    })
    this.once('wake-accounts', 1200, async () => {
      await this.accounts.refresh()
      await this.sessions.refresh()
    })
  }

  private kick(): void {
    this.once('kick-orchestration', 400, () => this.orchestration.poll())
    this.once('kick-agents', 600, () => this.agents.scan())
  }

  private async persist(force = false): Promise<void> {
    if (!force && this.store.seq === this.persistedSeq) return
    try {
      await this.persistence.saveSnapshot(this.store.snapshot())
      this.persistedSeq = this.store.seq
      await this.history.saveChangedRuns()
    } catch (error) {
      this.ctx.log(`persist failed: ${(error as Error).message}`)
    }
  }

  /** Uses the documented `orca plugin open` to show this plugin's panel. */
  private async showPanel(): Promise<string> {
    const list = await this.ctx.cli.run<{ plugins?: { key?: string; id?: string }[] } | { key?: string; id?: string }[]>(['plugin', 'list'], { timeoutMs: 8000 })
    if (!list.ok) return `Could not find the Agent Flow panel: ${list.message}`
    const rows = Array.isArray(list.result) ? list.result : (list.result.plugins ?? [])
    const key = rows.find((row) => row.id === 'agent-flow' || row.key?.endsWith('.agent-flow'))?.key
    if (!key) return 'Agent Flow is not listed as installed.'
    const opened = await this.ctx.cli.run(['plugin', 'open', key, '--panel', 'flow'], { timeoutMs: 8000 })
    return opened.ok ? 'Agent Flow panel opened.' : `Could not open the panel: ${opened.message}`
  }

  private updateStatusBar(): void {
    if (!this.orca.host.has('statusBar.update')) return
    const agents = Object.values(this.store.read().agents)
    const running = agents.filter((agent) => agent.live && (agent.state === 'working' || agent.state === 'blocked' || agent.state === 'waiting')).length
    const blocked = agents.filter((agent) => agent.live && agent.state === 'blocked').length
    const key = `${running}|${blocked}`
    if (key === this.statusKey) return
    this.statusKey = key
    void this.orca.host
      .call('statusBar.update', {
        id: 'agent-flow-status',
        text: running ? `Agent Flow · ${running} running${blocked ? ` · ${blocked} blocked` : ''}` : 'Agent Flow · idle',
        tone: blocked ? 'warning' : running ? 'accent' : 'neutral',
        tooltip: 'Live agents seen by Agent Flow'
      })
      .catch(() => {
        this.statusKey = ''
      })
  }

  private publishCapabilities(): void {
    const hostMethods: Record<string, boolean> = {}
    for (const method of HOST_METHODS) hostMethods[method] = this.orca.host.has(method)
    const probe = { hostHas: (m: string) => this.orca.host.has(m), cli: Boolean(this.ctx.cli.path), actAsCoordinator: this.settings.actAsCoordinator }
    const commands: Record<string, ReturnType<typeof commandAvailability>> = {}
    for (const kind of ALL_COMMANDS) commands[kind] = commandAvailability(kind, probe)
    this.store.put({
      entity: 'capabilities',
      id: 'capabilities',
      value: {
        hostMethods,
        commands,
        actAsCoordinator: this.settings.actAsCoordinator,
        chatSend: this.settings.chatSend,
        dashboardControls: this.settings.dashboardControls,
        cliAvailable: Boolean(this.ctx.cli.path),
        cliPath: this.ctx.cli.path,
        hooks: true,
        dashboard: { enabled: Boolean(this.dashboard), url: this.dashboard ? 'running' : null },
        apiMinor: this.orca.api.minor,
        homeDir: homedir()
      }
    })
  }

  private async readSettings(): Promise<Settings> {
    try {
      const raw = await this.orca.settings.get()
      return {
        // Unset means the default (on); only an explicit false turns a setting off.
        dashboardEnabled: raw.dashboardEnabled !== false,
        dashboardPort: typeof raw.dashboardPort === 'number' && raw.dashboardPort >= 1024 && raw.dashboardPort <= 65000 ? raw.dashboardPort : 4790,
        dashboardControls: raw.dashboardControls !== false,
        actAsCoordinator: raw.actAsCoordinator !== false,
        cliPath: typeof raw.cliPath === 'string' ? raw.cliPath.trim() : '',
        chatSend: raw.chatSend !== false,
        checkUpdates: raw.checkUpdates !== false
      }
    } catch {
      return DEFAULT_SETTINGS
    }
  }

  private async onSettingsChanged(): Promise<void> {
    const before = this.settings
    this.settings = await this.readSettings()
    if (before.cliPath !== this.settings.cliPath) {
      this.ctx.cli = createCliRunner(await resolveCliPath(this.settings.cliPath || null))
    }
    await this.syncDashboard(false)
    this.publishCapabilities()
  }

  /** Serialized: overlapping on/off requests can never leave a stray server running. */
  private syncDashboard(rotateToken: boolean): Promise<void> {
    this.dashboardOp = this.dashboardOp.catch(() => undefined).then(() => this.syncDashboardNow(rotateToken))
    return this.dashboardOp
  }

  private async syncDashboardNow(rotateToken: boolean): Promise<void> {
    const want = this.settings.dashboardEnabled && !this.stopped
    if (this.dashboard && (!want || rotateToken)) {
      await this.dashboard.stop()
      this.dashboard = null
    }
    if (!want || this.dashboard) {
      this.publishCapabilities()
      return
    }
    try {
      const protection = this.orca.host.has('secrets.protection') ? (await this.orca.host.call('secrets.protection', {})).status : 'unavailable'
      // Turning the dashboard on issues a new token, so an old link stops working.
      const token = rotateToken ? await rotateDashboardToken(this.orca.secrets, protection, stateDir()) : await loadOrCreateToken(this.orca.secrets, protection, stateDir())
      const server = new DashboardServer({
        uiDir: fileURLToPath(new URL('./ui/', import.meta.url)),
        token,
        port: this.settings.dashboardPort,
        allowControls: () => this.settings.dashboardControls,
        snapshot: () => {
          this.seen()
          return this.store.snapshot()
        },
        subscribe: (listener) => this.store.subscribe(listener),
        subscribeOutput: (listener) => this.outputWatcher.subscribe(listener),
        command: (input, allowed) => {
          this.seen()
          return this.router.handle(input, allowed)
        },
        log: this.ctx.log
      })
      await server.start()
      if (!this.settings.dashboardEnabled || this.stopped) await server.stop()
      else this.dashboard = server
      this.dashboardRetries = 0
    } catch (error) {
      this.ctx.log(`dashboard could not start: ${(error as Error).message}`)
      // Often transient (Orca re-checking approval during a reload, the port still closing):
      // try again with backoff instead of staying off until the next settings change.
      if (this.dashboardRetries < DASHBOARD_RETRIES) {
        const delay = 2000 * 2 ** this.dashboardRetries++
        this.once('dashboard-retry', delay, () => this.syncDashboard(false))
      }
    }
    this.publishCapabilities()
  }

  private async loadLabels(): Promise<void> {
    try {
      const raw = (await this.orca.storage.get('labels')) as Partial<LabelConfig> | null
      if (raw && typeof raw === 'object') {
        this.store.put({ entity: 'labels', id: 'labels', value: { ...EMPTY_LABELS, ...raw } as LabelConfig })
      }
    } catch {
      // labels are optional
    }
  }

  private async saveLabels(labels: LabelConfig): Promise<void> {
    await this.orca.storage.set('labels', labels as never)
    this.store.put({ entity: 'labels', id: 'labels', value: labels })
    await this.accounts.refresh()
  }
}
