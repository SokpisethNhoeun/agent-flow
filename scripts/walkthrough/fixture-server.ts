// A stand-in dashboard server for the fixture walkthrough: serves the real built UI (dist/ui) with
// test data, records every command the UI sends, and can push a live-output notice on demand.
// Loopback only, random port, test token; it never talks to Orca or any agent.
import { createServer, type ServerResponse } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, join, resolve, sep } from 'node:path'
import { fixtureConversation, fixtureHistory, fixtureState, fixtureSubagents } from './fixture-data.ts'

const MIME: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' }

export type Recorded = { kind: string; params: Record<string, unknown>; confirmed: boolean }

export async function startFixtureServer(uiDir: string) {
  const now = Date.now()
  const state = fixtureState(now)
  const history = fixtureHistory(now)
  const commands: Recorded[] = []
  const streams = new Set<ServerResponse>()
  const extraReplies: string[] = []
  const root = resolve(uiDir)
  const initiallyLive = new Set(Object.values(state.agents).filter((a) => a.live).map((a) => a.id))
  const initialState = new Map(Object.values(state.agents).map((a) => [a.id, a.state]))
  /** The live worker "writes" a reply: the next read includes it, and views are told at once. */
  const streamReply = (text: string) => {
    extraReplies.push(text)
    for (const stream of streams) stream.write(`event: output\ndata: ${JSON.stringify({ agentId: 'w_live' })}\n\n`)
  }

  const answer = (kind: string, params: Record<string, unknown>): unknown => {
    switch (kind) {
      case 'history.list':
        return history.list
      case 'history.load':
        return history.records[String(params.runId) as keyof typeof history.records] ?? null
      case 'agent.readOutput':
        return params.agentId === 'w_live' ? { ...fixtureConversation(extraReplies), version: `fx${String(extraReplies.length).padStart(8, '0')}` } : { kind: 'lines', source: 'terminal', lines: ['[Test fixture] no output for this agent'], truncated: false, version: 'fx00000000' }
      case 'dashboard.info':
        return { enabled: true, url: null }
      case 'worktree.inspect':
        return { branch: 'fx/branch', ahead: 0, behind: 0, files: [] }
      default:
        return { done: true }
    }
  }

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    // Test-only endpoints for the walkthrough process (this server runs in its own process).
    if (url.pathname === '/__test/commands') return json(res, commands)
    if (url.pathname === '/__test/reply' && req.method === 'POST') {
      const chunks: Buffer[] = []
      for await (const chunk of req) chunks.push(chunk as Buffer)
      streamReply(String((JSON.parse(Buffer.concat(chunks).toString('utf8')) as { text?: unknown }).text ?? ''))
      return json(res, { ok: true })
    }
    // One agent changes state (e.g. becomes blocked), as a single live update.
    if (url.pathname === '/__test/agent-state' && req.method === 'POST') {
      const agent = state.agents[url.searchParams.get('id') ?? '']
      const next = url.searchParams.get('state') as typeof agent.state | null
      if (!agent || !next) return json(res, { ok: false })
      const value = { ...agent, state: next, live: next !== 'done' && next !== 'failed', stateSince: Date.now(), version: agent.version + 1 }
      state.agents[agent.id] = value
      const delta = { fromSeq: state.seq, toSeq: state.seq + 1, patches: [{ entity: 'agent' as const, id: agent.id, value }], events: [] }
      state.seq += 1
      for (const stream of streams) stream.write(`event: delta\ndata: ${JSON.stringify(delta)}\n\n`)
      return json(res, { ok: true })
    }
    // The live worker spawns `n` sub-agents at once (a big box for the layout worker).
    if (url.pathname === '/__test/grow' && req.method === 'POST') {
      const n = Math.min(400, Number(url.searchParams.get('n') ?? 80))
      const added = fixtureSubagents('w_live', n, Object.keys(state.agents).length, Date.now())
      for (const agent of added) state.agents[agent.id] = agent
      const delta = { fromSeq: state.seq, toSeq: state.seq + 1, patches: added.map((agent) => ({ entity: 'agent' as const, id: agent.id, value: agent })), events: [] }
      state.seq += 1
      for (const stream of streams) stream.write(`event: delta\ndata: ${JSON.stringify(delta)}\n\n`)
      return json(res, { ok: true, added: n })
    }
    // Every live agent goes idle at once (as real agents do between turns): one ordered delta.
    // ...and /__test/live brings the originally live ones back to work.
    if ((url.pathname === '/__test/idle' || url.pathname === '/__test/live') && req.method === 'POST') {
      const live = url.pathname === '/__test/live'
      const patches = Object.values(state.agents)
        .filter((agent) => (live ? initiallyLive.has(agent.id) && !agent.live : agent.live))
        .map((agent) => {
          // Coming back restores each agent's own state (working, blocked…), not a blanket "working".
          const value = { ...agent, live, state: live ? initialState.get(agent.id)! : ('idle' as const), version: agent.version + 1 }
          state.agents[agent.id] = value
          return { entity: 'agent' as const, id: agent.id, value }
        })
      const delta = { fromSeq: state.seq, toSeq: state.seq + 1, patches, events: [] }
      state.seq += 1
      for (const stream of streams) stream.write(`event: delta\ndata: ${JSON.stringify(delta)}\n\n`)
      return json(res, { ok: true, changed: patches.length })
    }
    if (url.pathname === '/api/snapshot') return json(res, { state, events: [] })
    if (url.pathname === '/api/events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store' })
      res.write('event: hello\ndata: {}\n\n')
      streams.add(res)
      req.on('close', () => streams.delete(res))
      return
    }
    if (url.pathname === '/api/command' && req.method === 'POST') {
      const chunks: Buffer[] = []
      for await (const chunk of req) chunks.push(chunk as Buffer)
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { kind: string; params?: Record<string, unknown>; confirmed?: boolean }
      commands.push({ kind: body.kind, params: body.params ?? {}, confirmed: body.confirmed === true })
      const result = answer(body.kind, body.params ?? {})
      return json(res, result === null ? { ok: false, error: { code: 'not_found', message: 'No such saved run.' } } : { ok: true, result })
    }
    const name = url.pathname === '/' ? 'dashboard.html' : url.pathname.slice(1)
    const file = resolve(root, name)
    if (!file.startsWith(root + sep) || name.endsWith('.br')) return void res.writeHead(404).end()
    try {
      const data = await readFile(file)
      res.writeHead(200, { 'Content-Type': MIME[extname(name)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' })
      res.end(data)
    } catch {
      res.writeHead(404).end()
    }
  })
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
  const port = (server.address() as { port: number }).port
  return {
    url: `http://127.0.0.1:${port}/#token=fixture-test-token`,
    origin: `http://127.0.0.1:${port}`,
    commands,
    streamReply,
    async stop() {
      for (const stream of streams) stream.end()
      await new Promise<void>((done) => server.close(() => done()))
    }
  }
}

function json(res: ServerResponse, value: unknown) {
  res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(value))
}

export const UI_DIR = join(process.cwd(), 'dist', 'ui')
