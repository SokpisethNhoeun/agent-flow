// Account identity per agent, evidence first:
//  1. `orca account list` for the accounts themselves (ids, provider, email, active one);
//  2. each account home's `sessions/<pid>.json` (written by the agent CLI) maps sessionId → account;
//  3. fallback: the agent.launch.before hook records which account profile a terminal launched with.
// Tokens and credentials are never read or stored.
import { readdir, readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import type { AccountRecord, AccountRef } from '../../shared/model.ts'
import { str, type WorkerContext } from '../context.ts'

type CliAccount = { id: string; email?: string | null; home?: string | null }
type CliProvider = { accounts?: CliAccount[]; activeAccountId?: string | null }

/** Env vars agent CLIs read their profile directory from. */
const PROFILE_ENV_KEYS = ['CLAUDE_CONFIG_DIR', 'CODEX_HOME', 'GEMINI_CONFIG_DIR', 'OPENCODE_CONFIG_DIR']
const MAX_SESSION_FILES = 400

export class AccountsAdapter {
  private homes = new Map<string, { accountId: string; provider: string }>()
  private sessionAccount = new Map<string, string>()
  /** Session files also carry the agent CLI's pid and busy/idle status: live evidence. */
  private sessionProcess = new Map<string, { pid: number; procStart: string | null; status: string | null; updatedAt: number | null }>()
  private terminalAccount = new Map<string, string>()

  constructor(private readonly ctx: WorkerContext) {}

  /** Profile homes of Codex accounts (each may keep its own sessions/). */
  codexHomes(): string[] {
    return [...this.homes.entries()].filter(([, v]) => v.provider === 'codex').map(([home]) => home)
  }

  /** Profile homes of Claude accounts (each has its own projects/ and sessions/). */
  claudeHomes(): string[] {
    return [...this.homes.entries()].filter(([, v]) => v.provider === 'claude').map(([home]) => home)
  }

  async refresh(): Promise<void> {
    await this.loadAccounts()
    this.sessionProcess.clear()
    await this.scanSessionFiles()
    this.applyToAgents()
    await this.applyLiveness()
  }

  /**
   * Live evidence for agents Orca's events have not reported since a restart: the agent CLI's
   * session file names its pid; if that process is running, the agent is live. Never overrides a
   * newer status event (the store orders state by observation time).
   */
  async applyLiveness(): Promise<void> {
    for (const agent of Object.values(this.ctx.store.read().agents)) {
      if (!agent.sessionId || agent.role === 'subagent') continue
      const proc = this.sessionProcess.get(agent.sessionId)
      if (!proc) continue
      const alive = await processAlive(proc.pid, proc.procStart)
      if (agent.live === alive && agent.state !== 'unknown') continue
      const state = !alive ? (agent.state === 'unknown' || agent.live ? 'done' : agent.state) : proc.status === 'busy' ? 'working' : 'waiting'
      this.ctx.store.upsertAgent(agent.id, proc.updatedAt ?? 0, { live: alive, state, evidence: ['session-file'] }, () => agent)
    }
  }

  private async loadAccounts(): Promise<void> {
    const result = await this.ctx.cli.run<Record<string, CliProvider>>(['account', 'list'])
    if (!result.ok) {
      this.ctx.log(`account list: ${result.code} ${result.message}`)
      return
    }
    const labels = this.ctx.store.read().labels
    const seen = new Set<string>()
    for (const [provider, info] of Object.entries(result.result)) {
      if (!info || !Array.isArray(info.accounts)) continue
      for (const account of info.accounts) {
        seen.add(account.id)
        const email = str(account.email)
        const record: AccountRecord = {
          id: account.id,
          provider,
          email,
          label: labels.accountTeams[account.id] ?? (email ? labels.accountTeams[email] : undefined) ?? null,
          active: info.activeAccountId === account.id
        }
        this.ctx.store.put({ entity: 'account', id: account.id, value: record })
        const home = str(account.home)
        if (home) this.homes.set(resolve(home), { accountId: account.id, provider })
      }
    }
    for (const id of Object.keys(this.ctx.store.read().accounts)) if (!seen.has(id)) this.ctx.store.put({ entity: 'account', id, value: null })
  }

  private async scanSessionFiles(): Promise<void> {
    let budget = MAX_SESSION_FILES
    for (const [home, { accountId }] of this.homes) {
      const dir = join(home, 'sessions')
      let names: string[]
      try {
        names = (await readdir(dir)).filter((name) => /^\d+\.json$/.test(name))
      } catch {
        continue
      }
      for (const name of names) {
        if (budget-- <= 0) return
        try {
          const parsed = JSON.parse(await readFile(join(dir, name), 'utf8')) as { sessionId?: unknown; pid?: unknown; procStart?: unknown; status?: unknown; updatedAt?: unknown }
          const sessionId = str(parsed.sessionId)
          if (sessionId) {
            this.sessionAccount.set(sessionId, accountId)
            if (typeof parsed.pid === 'number') this.sessionProcess.set(sessionId, { pid: parsed.pid, procStart: parsed.procStart == null ? null : String(parsed.procStart), status: str(parsed.status), updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : null })
          }
        } catch {
          // a file being written right now; next scan picks it up
        }
      }
    }
  }

  /** agent.launch.before: record the profile dir only. Returns nothing, so the launch goes on. */
  onLaunch(event: { agent: string; terminalId?: string; env: Record<string, string> }): void {
    if (!event.terminalId) return
    for (const key of PROFILE_ENV_KEYS) {
      const value = event.env?.[key]
      if (!value) continue
      const accountId = this.accountForProfileDir(value)
      if (accountId) {
        this.terminalAccount.set(event.terminalId, accountId)
        return
      }
    }
  }

  accountForProfileDir(dir: string): string | null {
    const target = resolve(dir)
    for (const [home, { accountId }] of this.homes) {
      // Exact profile dir, its home, or inside it. Never a broad ancestor folder.
      if (target === home || target === dirname(home) || target.startsWith(home + '/')) return accountId
    }
    return null
  }

  applyToAgents(): void {
    const state = this.ctx.store.read()
    for (const agent of Object.values(state.agents)) {
      let ref: AccountRef | null = null
      const fromSession = agent.sessionId ? this.sessionAccount.get(agent.sessionId) : undefined
      const fromLaunch = agent.terminalId ? this.terminalAccount.get(agent.terminalId) : undefined
      if (fromSession) ref = this.ref(fromSession, 'session-file')
      else if (fromLaunch) ref = this.ref(fromLaunch, 'launch-capture')
      else if (agent.role === 'subagent' && agent.parentId) ref = state.agents[agent.parentId]?.account ?? null
      if (!ref) continue
      if (agent.account && agent.account.accountId === ref.accountId && agent.account.label === ref.label) continue
      this.ctx.store.upsertAgent(agent.id, agent.lastSeenAt, { account: ref, evidence: [ref.source] }, () => agent)
    }
  }

  private ref(accountId: string, source: AccountRef['source']): AccountRef {
    const account = this.ctx.store.read().accounts[accountId]
    const labels = this.ctx.store.read().labels
    const label = labels.accountTeams[accountId] ?? (account?.email ? labels.accountTeams[account.email] : undefined) ?? account?.email ?? null
    return { accountId, label, provider: account?.provider ?? null, source }
  }
}

/**
 * Is the agent CLI that wrote the session file still running? A pid can be reused by another
 * process, so on Linux the process start time must also match the file's `procStart`.
 */
export async function processAlive(pid: number, procStart: string | null): Promise<boolean> {
  try {
    process.kill(pid, 0)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EPERM') return false
  }
  if (procStart && process.platform === 'linux') {
    try {
      const stat = await readFile(`/proc/${pid}/stat`, 'utf8')
      const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ')
      return fields[19] === procStart
    } catch {
      return false
    }
  }
  return true
}
