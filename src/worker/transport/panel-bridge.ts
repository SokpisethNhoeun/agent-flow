// Orca panels and the canvas editor talk to the worker through plugin.request / panels.post.
import type { OrcaWorkerApi } from 'orca/worker'
import type { FlowDelta, FlowSnapshot } from '../../shared/events.ts'
import type { CommandResponse } from '../../shared/commands.ts'
import { fitSnapshot } from './snapshot-budget.ts'

/** panels.post payloads are capped at 256 KiB; larger deltas become a resync request. */
const MAX_POST_BYTES = 200 * 1024

export function connectPanels(
  panels: OrcaWorkerApi['panels'],
  deps: {
    snapshot: () => FlowSnapshot
    subscribe: (listener: (delta: FlowDelta) => void) => () => void
    /** Live output notices: an agent's conversation changed (only its id is sent). */
    subscribeOutput?: (listener: (agentId: string) => void) => () => void
    command: (input: unknown) => Promise<CommandResponse>
    log: (message: string) => void
  }
): () => void {
  const disposers = [
    panels.handle('flow.snapshot', () => fitSnapshot(deps.snapshot()) as never),
    panels.handle('flow.command', (input) => deps.command(input) as never)
  ]
  const unsubscribe = deps.subscribe((delta) => {
    try {
      const json = JSON.stringify(delta)
      if (Buffer.byteLength(json) > MAX_POST_BYTES) panels.post('flow.resync', { toSeq: delta.toSeq })
      else panels.post('flow.delta', delta as never)
    } catch (error) {
      deps.log(`panel post failed: ${(error as Error).message}`)
    }
  })
  const unsubscribeOutput = deps.subscribeOutput?.((agentId) => {
    try {
      panels.post('flow.output', { agentId })
    } catch (error) {
      deps.log(`panel post failed: ${(error as Error).message}`)
    }
  })
  return () => {
    unsubscribe()
    unsubscribeOutput?.()
    for (const disposer of disposers) disposer.dispose()
  }
}
