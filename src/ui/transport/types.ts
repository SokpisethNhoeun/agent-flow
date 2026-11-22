import type { CommandRequest, CommandResponse } from '../../shared/commands.ts'
import type { FlowDelta, FlowSnapshot } from '../../shared/events.ts'

export type ConnectionStatus = 'connecting' | 'live' | 'reconnecting' | 'offline'

export type TransportHandlers = {
  delta: (delta: FlowDelta) => void
  resync: () => void
  status: (status: ConnectionStatus) => void
  /** An agent's conversation changed; views showing it fetch again. */
  output?: (agentId: string) => void
}

/** One UI, three hosts: Orca panel, Orca canvas editor, browser dashboard. */
export type Transport = {
  readonly kind: 'orca' | 'http'
  snapshot(): Promise<FlowSnapshot>
  command(request: CommandRequest): Promise<CommandResponse>
  /** Pushes deltas, resync requests and connection changes. Returns an unsubscribe. */
  subscribe(handlers: TransportHandlers): () => void
  /** Opens an http(s) link in the person's browser, when the host allows it. */
  openExternal?(url: string): Promise<void>
}
