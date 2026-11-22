// Browser dashboard: token from the URL fragment (never sent to the server in the URL),
// snapshot over fetch, live deltas over a fetch-streamed SSE so the token stays in a header.
import type { CommandRequest, CommandResponse } from '../../shared/commands.ts'
import type { FlowDelta, FlowSnapshot } from '../../shared/events.ts'
import type { ConnectionStatus, Transport } from './types.ts'

export function readToken(): string | null {
  const fromHash = new URLSearchParams(location.hash.replace(/^#/, '')).get('token')
  if (fromHash) {
    try {
      sessionStorage.setItem('agent-flow-token', fromHash)
    } catch {
      // storage may be blocked; the hash still works for this load
    }
    history.replaceState(null, '', location.pathname)
    return fromHash
  }
  try {
    return sessionStorage.getItem('agent-flow-token')
  } catch {
    return null
  }
}

export function createHttpTransport(token: string): Transport {
  const headers = { Authorization: `Bearer ${token}` }
  return {
    kind: 'http',
    async snapshot() {
      const res = await fetch('/api/snapshot', { headers, cache: 'no-store' })
      if (!res.ok) throw new Error(res.status === 401 ? 'The dashboard link is missing its token or the token is wrong.' : `Snapshot failed (${res.status}).`)
      return (await res.json()) as FlowSnapshot
    },
    async command(request: CommandRequest) {
      try {
        const res = await fetch('/api/command', { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(request) })
        return (await res.json()) as CommandResponse
      } catch (error) {
        return { ok: false, error: { code: 'offline', message: (error as Error).message } }
      }
    },
    subscribe(handlers) {
      let stopped = false
      let controller: AbortController | null = null
      let attempt = 0
      const setStatus = (status: ConnectionStatus) => handlers.status(status)
      const connect = async () => {
        while (!stopped) {
          controller = new AbortController()
          try {
            setStatus(attempt === 0 ? 'connecting' : 'reconnecting')
            const res = await fetch('/api/events', { headers, signal: controller.signal, cache: 'no-store' })
            if (!res.ok || !res.body) throw new Error(`stream ${res.status}`)
            attempt = 0
            setStatus('live')
            handlers.resync()
            await readStream(res.body, (event, data) => {
              if (event === 'delta') handlers.delta(JSON.parse(data) as FlowDelta)
              else if (event === 'output') {
                const agentId = (JSON.parse(data) as { agentId?: unknown }).agentId
                if (typeof agentId === 'string') handlers.output?.(agentId)
              }
            })
          } catch {
            if (stopped) return
          }
          attempt++
          setStatus(attempt > 5 ? 'offline' : 'reconnecting')
          await new Promise((resolve) => setTimeout(resolve, Math.min(15000, 500 * 2 ** Math.min(attempt, 5))))
        }
      }
      void connect()
      return () => {
        stopped = true
        controller?.abort()
      }
    },
    async openExternal(url: string) {
      window.open(url, '_blank', 'noopener,noreferrer')
    }
  }
}

async function readStream(body: ReadableStream<Uint8Array>, onEvent: (event: string, data: string) => void): Promise<void> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  for (;;) {
    const { value, done } = await reader.read()
    if (done) return
    buffer += decoder.decode(value, { stream: true })
    let index: number
    while ((index = buffer.indexOf('\n\n')) >= 0) {
      const block = buffer.slice(0, index)
      buffer = buffer.slice(index + 2)
      let event = 'message'
      const data: string[] = []
      for (const line of block.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim()
        else if (line.startsWith('data:')) data.push(line.slice(5).trimStart())
      }
      if (data.length) onEvent(event, data.join('\n'))
    }
  }
}
