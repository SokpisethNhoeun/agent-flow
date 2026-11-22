// Standalone dashboard: the same UI bundle and the same authoritative state, served on loopback.
// Every /api call needs the token (header), the Host must be loopback, and POSTs must come from
// our own origin with a JSON body, so other sites in the person's browser cannot drive it.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, resolve, sep } from 'node:path'
import { READ_ONLY_COMMANDS, type CommandKind, type CommandResponse } from '../../shared/commands.ts'
import type { FlowDelta, FlowSnapshot } from '../../shared/events.ts'
import { hostAllowed, tokensMatch } from './auth.ts'

export type DashboardDeps = {
  uiDir: string
  token: string
  port: number
  allowControls: () => boolean
  snapshot: () => FlowSnapshot
  subscribe: (listener: (delta: FlowDelta) => void) => () => void
  /** Live output notices: an agent's conversation changed (only its id is sent). */
  subscribeOutput?: (listener: (agentId: string) => void) => () => void
  command: (input: unknown, allowed: (kind: CommandKind) => boolean) => Promise<CommandResponse>
  log: (message: string) => void
}

const MIME: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json', '.png': 'image/png' }
const STATIC_FILES = new Set(['dashboard.html', 'app.js', 'app.css', 'icon.svg', 'layout-worker.js'])
/** Code-split UI chunks that esbuild names `chunks/<name>-<hash>.js` (loaded on demand). */
const CHUNK_FILE = /^chunks\/[A-Za-z0-9_-]{1,80}\.js$/
const MAX_BODY = 128 * 1024
const MAX_CLIENTS = 8

export class DashboardServer {
  private server: Server | null = null
  private clients = new Set<ServerResponse>()
  private unsubscribe: (() => void) | null = null
  private unsubscribeOutput: (() => void) | null = null
  private boundPort: number | null = null

  constructor(private readonly deps: DashboardDeps) {}

  get url(): string | null {
    return this.boundPort ? `http://127.0.0.1:${this.boundPort}/#token=${this.deps.token}` : null
  }

  async start(): Promise<void> {
    for (let attempt = 0; attempt < 10; attempt++) {
      const port = this.deps.port + attempt
      try {
        await this.listen(port)
        this.boundPort = port
        this.unsubscribe = this.deps.subscribe((delta) => this.broadcast('delta', delta))
        this.unsubscribeOutput = this.deps.subscribeOutput?.((agentId) => this.broadcast('output', { agentId })) ?? null
        this.deps.log(`dashboard listening on 127.0.0.1:${port}`)
        return
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EADDRINUSE') throw error
      }
    }
    throw new Error(`No free port from ${this.deps.port} to ${this.deps.port + 9}.`)
  }

  async stop(): Promise<void> {
    this.unsubscribe?.()
    this.unsubscribe = null
    this.unsubscribeOutput?.()
    this.unsubscribeOutput = null
    for (const client of this.clients) client.end()
    this.clients.clear()
    await new Promise<void>((resolve) => (this.server ? this.server.close(() => resolve()) : resolve()))
    this.server = null
    this.boundPort = null
  }

  private listen(port: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const server = createServer((req, res) => void this.route(req, res, port))
      server.once('error', reject)
      server.listen(port, '127.0.0.1', () => {
        server.off('error', reject)
        this.server = server
        resolve()
      })
    })
  }

  private async route(req: IncomingMessage, res: ServerResponse, port: number): Promise<void> {
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('Referrer-Policy', 'no-referrer')
    res.setHeader('Cache-Control', 'no-store')
    if (!hostAllowed(req.headers.host, port)) return send(res, 421, 'Wrong host')
    const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`)
    try {
      if (url.pathname.startsWith('/api/')) return await this.api(req, res, url, port)
      if (req.method !== 'GET') return send(res, 405, 'Method not allowed')
      return await this.serveStatic(res, url.pathname, acceptsBrotli(req.headers['accept-encoding']))
    } catch (error) {
      this.deps.log(`dashboard error: ${(error as Error).message}`)
      if (!res.headersSent) send(res, 500, 'Internal error')
    }
  }

  private async api(req: IncomingMessage, res: ServerResponse, url: URL, port: number): Promise<void> {
    const auth = req.headers.authorization?.replace(/^Bearer\s+/i, '')
    if (!tokensMatch(this.deps.token, auth)) return sendJson(res, 401, { ok: false, error: { code: 'unauthorized', message: 'Missing or wrong token.' } })
    if (url.pathname === '/api/snapshot' && req.method === 'GET') return sendJson(res, 200, this.deps.snapshot())
    if (url.pathname === '/api/events' && req.method === 'GET') return this.openStream(req, res)
    if (url.pathname === '/api/command' && req.method === 'POST') {
      const origin = req.headers.origin
      if (origin && origin !== `http://127.0.0.1:${port}` && origin !== `http://localhost:${port}`) return sendJson(res, 403, { ok: false, error: { code: 'forbidden', message: 'Cross-origin request refused.' } })
      if (!(req.headers['content-type'] ?? '').startsWith('application/json')) return sendJson(res, 415, { ok: false, error: { code: 'unsupported_media', message: 'Send JSON.' } })
      const body = await readBody(req)
      let parsed: unknown
      try {
        parsed = JSON.parse(body)
      } catch {
        return sendJson(res, 400, { ok: false, error: { code: 'invalid_params', message: 'Body is not JSON.' } })
      }
      const controls = this.deps.allowControls()
      const result = await this.deps.command(parsed, (kind) => kind !== 'dashboard.enable' && kind !== 'dashboard.controls' && (controls || READ_ONLY_COMMANDS.has(kind)))
      return sendJson(res, 200, result)
    }
    return sendJson(res, 404, { ok: false, error: { code: 'not_found', message: 'No such endpoint.' } })
  }

  private openStream(req: IncomingMessage, res: ServerResponse): void {
    if (this.clients.size >= MAX_CLIENTS) return sendJson(res, 429, { ok: false, error: { code: 'too_many_clients', message: 'Too many dashboards open.' } })
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' })
    res.write(`event: hello\ndata: {}\n\n`)
    this.clients.add(res)
    const heartbeat = setInterval(() => res.write(`: ping\n\n`), 15000)
    req.on('close', () => {
      clearInterval(heartbeat)
      this.clients.delete(res)
    })
  }

  private broadcast(event: 'delta' | 'output', data: FlowDelta | { agentId: string }): void {
    if (!this.clients.size) return
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
    for (const client of this.clients) client.write(payload)
  }

  private async serveStatic(res: ServerResponse, pathname: string, brotli: boolean): Promise<void> {
    const name = pathname === '/' ? 'dashboard.html' : pathname.replace(/^\/+/, '')
    if (!STATIC_FILES.has(name) && !CHUNK_FILE.test(name)) return send(res, 404, 'Not found')
    const root = resolve(this.deps.uiDir)
    const file = resolve(root, name)
    if (!file.startsWith(root + sep)) return send(res, 404, 'Not found')
    let data: Buffer
    let encoded = false
    try {
      // The build writes a brotli copy next to each file; fall back to the plain file without it.
      if (brotli) {
        data = await readFile(`${file}.br`).then((d) => ((encoded = true), d)).catch(() => readFile(file))
      } else data = await readFile(file)
    } catch {
      return send(res, 404, 'Not found')
    }
    res.writeHead(200, {
      ...(encoded ? { 'Content-Encoding': 'br' } : {}),
      Vary: 'Accept-Encoding',
      'Content-Type': MIME[extname(name)] ?? 'application/octet-stream',
      'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
      'X-Frame-Options': 'DENY',
      // Hashed chunks never change; everything else is re-checked so a rebuild shows up on reload.
      'Cache-Control': CHUNK_FILE.test(name) ? 'public, max-age=31536000, immutable' : 'no-cache'
    })
    res.end(data)
  }
}

export function acceptsBrotli(header: string | string[] | undefined): boolean {
  const value = Array.isArray(header) ? header.join(',') : (header ?? '')
  return value.split(',').some((part) => {
    const [name, ...params] = part.trim().split(';')
    if (name.trim().toLowerCase() !== 'br') return false
    const q = params.map((p) => p.trim()).find((p) => p.startsWith('q='))
    return !q || Number(q.slice(2)) > 0
  })
}

function send(res: ServerResponse, status: number, text: string): void {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' })
  res.end(text)
}

function sendJson(res: ServerResponse, status: number, value: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(value))
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_BODY) {
        reject(new Error('Body too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}
