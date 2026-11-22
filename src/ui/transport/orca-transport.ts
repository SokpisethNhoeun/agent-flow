// Inside Orca: window.orca.plugin.request(...) to the worker, plugin.on(...) for its posts.
import type { CommandRequest, CommandResponse } from '../../shared/commands.ts'
import type { FlowDelta, FlowSnapshot } from '../../shared/events.ts'
import type { Transport } from './types.ts'

type OrcaFrame = {
  plugin: {
    request(name: string, input?: unknown, options?: { timeoutMs?: number }): Promise<unknown>
    on(event: string, handler: (payload: unknown) => void): { dispose(): void }
  }
  shell?: { openExternal(url: string): Promise<{ opened: boolean }> }
}

export function orcaFrame(): OrcaFrame | null {
  const candidate = (globalThis as { orca?: OrcaFrame }).orca
  return candidate && typeof candidate.plugin?.request === 'function' ? candidate : null
}

export function createOrcaTransport(frame: OrcaFrame): Transport {
  return {
    kind: 'orca',
    async snapshot() {
      return (await frame.plugin.request('flow.snapshot', undefined, { timeoutMs: 20000 })) as FlowSnapshot
    },
    async command(request: CommandRequest) {
      try {
        return (await frame.plugin.request('flow.command', request, { timeoutMs: 120000 })) as CommandResponse
      } catch (error) {
        const err = error as Error & { code?: string }
        return { ok: false, error: { code: err.code ?? 'action_failed', message: err.message } }
      }
    },
    subscribe(handlers) {
      const subs = [
        frame.plugin.on('flow.delta', (payload) => handlers.delta(payload as FlowDelta)),
        frame.plugin.on('flow.resync', () => handlers.resync()),
        frame.plugin.on('flow.output', (payload) => {
          const agentId = (payload as { agentId?: unknown } | null)?.agentId
          if (typeof agentId === 'string') handlers.output?.(agentId)
        })
      ]
      return () => subs.forEach((sub) => sub.dispose())
    },
    openExternal: frame.shell
      ? async (url: string) => {
          await frame.shell!.openExternal(url)
        }
      : undefined
  }
}
