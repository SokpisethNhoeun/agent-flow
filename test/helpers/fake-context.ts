// Shared fakes: a WorkerContext with a scripted host API and CLI, backed by the real
// FlowStore and IdentityIndex so tests exercise the actual state logic.
import type { CliResult, CliRunner } from '../../src/worker/cli/orca-cli.ts'
import type { WorkerContext } from '../../src/worker/context.ts'
import { IdentityIndex } from '../../src/worker/state/identity-index.ts'
import { FlowStore } from '../../src/worker/state/store.ts'

export type HostHandler = (params: unknown) => unknown

export class FakeHost {
  readonly calls: { method: string; params: unknown }[] = []
  private readonly handlers: Record<string, HostHandler>
  constructor(handlers: Record<string, HostHandler> = {}) {
    this.handlers = handlers
  }

  has(method: string): boolean {
    return method in this.handlers
  }

  async call(method: string, params?: unknown): Promise<unknown> {
    this.calls.push({ method, params })
    const handler = this.handlers[method]
    if (!handler) throw Object.assign(new Error(`unknown method ${method}`), { code: 'unknown_method' })
    return handler(params)
  }

  callsTo(method: string): unknown[] {
    return this.calls.filter((c) => c.method === method).map((c) => c.params)
  }
}

/** A canned answer: a plain value is wrapped as `{ ok: true, result }`; a function sees the args. */
export type CliResponse = unknown | ((args: string[]) => CliResult<unknown>)

export class FakeCli implements CliRunner {
  readonly calls: { args: string[]; options?: { timeoutMs?: number; stdin?: string } }[] = []
  readonly path: string | null
  private readonly responses: Record<string, CliResponse>

  constructor(responses: Record<string, CliResponse> = {}, path: string | null = '/fake/orca') {
    this.responses = responses
    this.path = path
  }

  /** Responses are keyed by the first two args, e.g. "orchestration run-list" or "account list". */
  set(key: string, response: CliResponse): void {
    this.responses[key] = response
  }

  async run<T = unknown>(args: string[], options?: { timeoutMs?: number; stdin?: string }): Promise<CliResult<T>> {
    this.calls.push({ args, options })
    const key = args.slice(0, 2).join(' ')
    if (!(key in this.responses)) return { ok: false, code: 'not_found', message: `no fake for ${key}` }
    const response = this.responses[key]
    if (typeof response === 'function') return (response as (a: string[]) => CliResult<T>)(args)
    return { ok: true, result: structuredClone(response) as T }
  }

  callsTo(key: string): string[][] {
    return this.calls.filter((c) => c.args.slice(0, 2).join(' ') === key).map((c) => c.args)
  }
}

export type Clock = { value: number; now: () => number; advance: (ms: number) => number }

export function makeClock(start = 1_800_000_000_000): Clock {
  const clock: Clock = {
    value: start,
    now: () => clock.value,
    advance: (ms) => (clock.value += ms)
  }
  return clock
}

export type FakeContext = { ctx: WorkerContext; host: FakeHost; cli: FakeCli; clock: Clock; logs: string[] }

export function makeContext(options: { host?: Record<string, HostHandler>; cli?: Record<string, CliResponse>; cliPath?: string | null; apiMinor?: number; store?: FlowStore } = {}): FakeContext {
  const host = new FakeHost(options.host)
  const cli = new FakeCli(options.cli, options.cliPath === undefined ? '/fake/orca' : options.cliPath)
  const clock = makeClock()
  const logs: string[] = []
  const log = (message: string) => void logs.push(message)
  const ctx: WorkerContext = {
    orca: {
      host: host as unknown as WorkerContext['orca']['host'],
      log,
      api: { major: 1, minor: options.apiMinor ?? 10 }
    },
    store: options.store ?? new FlowStore(0),
    cli,
    identity: new IdentityIndex(),
    now: clock.now,
    log
  }
  return { ctx, host, cli, clock, logs }
}
