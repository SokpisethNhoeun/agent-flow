import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { request } from 'node:http'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { brotliCompressSync, brotliDecompressSync } from 'node:zlib'
import { acceptsBrotli, DashboardServer } from '../src/worker/dashboard/server.ts'
import { newToken } from '../src/worker/dashboard/auth.ts'
import { command, makeRouter } from './helpers/router-setup.ts'
import { tempDir } from './helpers/fixtures.ts'

type Reply = { status: number; headers: Record<string, string | string[] | undefined>; body: string }

function call(port: number, options: { method?: string; path: string; headers?: Record<string, string>; body?: string }): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, method: options.method ?? 'GET', path: options.path, headers: options.headers }, (res) => {
      const chunks: Buffer[] = []
      res.on('data', (chunk: Buffer) => chunks.push(chunk))
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }))
    })
    req.on('error', reject)
    req.end(options.body)
  })
}

describe('DashboardServer', () => {
  const token = newToken()
  let allowControls = true
  let server: DashboardServer
  let port = 0
  let cleanup: () => Promise<void> = async () => {}
  let fake: ReturnType<typeof makeRouter>

  before(async () => {
    const tmp = await tempDir()
    cleanup = tmp.cleanup
    await writeFile(join(tmp.dir, 'dashboard.html'), '<!doctype html><title>Agent Flow</title>')
    await writeFile(join(tmp.dir, 'secret.txt'), 'do not serve')
    await writeFile(join(tmp.dir, 'app.css'), 'body{color:red}')
    await writeFile(join(tmp.dir, 'app.css.br'), brotliCompressSync(Buffer.from('body{color:red}')))
    await writeFile(join(tmp.dir, 'secret.txt.br'), brotliCompressSync(Buffer.from('do not serve')))
    fake = makeRouter({ host: { 'terminal.focus': () => ({ focused: true }) } })
    server = new DashboardServer({
      uiDir: tmp.dir,
      token,
      port: 47900 + Math.floor(Math.random() * 900),
      allowControls: () => allowControls,
      snapshot: () => fake.ctx.store.snapshot(),
      subscribe: (listener) => fake.ctx.store.subscribe(listener),
      command: (input, allowed) => fake.router.handle(input, allowed),
      log: () => {}
    })
    await server.start()
    port = Number(new URL(server.url!).port)
  })

  after(async () => {
    await server.stop()
    fake.ctx.store.dispose()
    await cleanup()
  })

  const auth = () => ({ Authorization: `Bearer ${token}` })
  const post = (body: unknown, headers: Record<string, string> = {}) =>
    call(port, { method: 'POST', path: '/api/command', headers: { ...auth(), 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) })

  it('exposes a loopback URL carrying the token', () => {
    assert.equal(server.url, `http://127.0.0.1:${port}/#token=${token}`)
  })

  it('GET /api/snapshot without a token → 401', async () => {
    const reply = await call(port, { path: '/api/snapshot' })
    assert.equal(reply.status, 401)
    assert.equal(JSON.parse(reply.body).error.code, 'unauthorized')
  })

  it('GET /api/snapshot with a wrong token → 401', async () => {
    assert.equal((await call(port, { path: '/api/snapshot', headers: { Authorization: 'Bearer nope' } })).status, 401)
  })

  it('a foreign Host header → 421 (DNS rebinding guard)', async () => {
    const reply = await call(port, { path: '/api/snapshot', headers: { ...auth(), Host: `evil.example:${port}` } })
    assert.equal(reply.status, 421)
  })

  it('GET /api/snapshot with the bearer token → 200 JSON', async () => {
    const reply = await call(port, { path: '/api/snapshot', headers: auth() })
    assert.equal(reply.status, 200)
    assert.match(String(reply.headers['content-type']), /^application\/json/)
    assert.equal(reply.headers['cache-control'], 'no-store')
    const snapshot = JSON.parse(reply.body)
    assert.ok(snapshot.state.runs.run_1)
    assert.ok(Array.isArray(snapshot.events))
  })

  it('unknown API endpoint → 404', async () => {
    assert.equal((await call(port, { path: '/api/nope', headers: auth() })).status, 404)
  })

  it('POST /api/command from a foreign Origin → 403', async () => {
    const reply = await post(command('dashboard.info'), { Origin: 'https://evil.example' })
    assert.equal(reply.status, 403)
  })

  it('POST /api/command from our own origin is accepted', async () => {
    const reply = await post(command('dashboard.info'), { Origin: `http://127.0.0.1:${port}` })
    assert.equal(reply.status, 200)
    assert.equal(JSON.parse(reply.body).ok, true)
  })

  it('POST /api/command with a non-JSON content type → 415', async () => {
    const reply = await post(command('dashboard.info'), { 'Content-Type': 'text/plain' })
    assert.equal(reply.status, 415)
  })

  it('POST /api/command with a broken body → 400', async () => {
    const reply = await call(port, { method: 'POST', path: '/api/command', headers: { ...auth(), 'Content-Type': 'application/json' }, body: '{broken' })
    assert.equal(reply.status, 400)
  })

  it('POST /api/command runs a valid command', async () => {
    const reply = await post(command('terminal.focus', { terminalId: 't1' }))
    assert.deepEqual(JSON.parse(reply.body), { ok: true, result: { focused: true } })
  })

  it('without control rights a mutating command is not_permitted, read-only still works', async () => {
    allowControls = false
    try {
      const mutating = JSON.parse((await post(command('terminal.focus', { terminalId: 't1' }))).body)
      assert.equal(mutating.ok, false)
      assert.equal(mutating.error.code, 'not_permitted')
      const readOnly = JSON.parse((await post(command('dashboard.info'))).body)
      assert.equal(readOnly.ok, true)
      assert.deepEqual(readOnly.result, { enabled: true, url: 'http://127.0.0.1:1/#token=x' })
    } finally {
      allowControls = true
    }
  })

  it("serves dashboard.html at '/' with security headers", async () => {
    const reply = await call(port, { path: '/' })
    assert.equal(reply.status, 200)
    assert.match(reply.body, /Agent Flow/)
    assert.match(String(reply.headers['content-type']), /^text\/html/)
    assert.match(String(reply.headers['content-security-policy']), /default-src 'self'/)
    assert.equal(reply.headers['x-frame-options'], 'DENY')
    assert.equal(reply.headers['x-content-type-options'], 'nosniff')
  })

  it('static files also require a loopback Host', async () => {
    assert.equal((await call(port, { path: '/', headers: { Host: 'evil.example' } })).status, 421)
  })

  it('refuses files outside the allow-list and path traversal', async () => {
    for (const path of ['/secret.txt', '/../x', '/../../etc/passwd', '/..%2fsecret.txt', '/%2e%2e/secret.txt', '//etc/passwd']) {
      assert.equal((await call(port, { path })).status, 404, path)
    }
  })

  it('a known static name whose file is missing is a 404 and does not crash the server', async () => {
    const reply = await call(port, { path: '/app.js' })
    assert.equal(reply.status, 404)
    assert.equal((await call(port, { path: '/' })).status, 200)
  })

  it('serves only well-formed chunk names', async () => {
    assert.equal((await call(port, { path: '/chunks/AgentChat-ABC123.js' })).status, 404)
    assert.equal((await call(port, { path: '/chunks/../../etc/passwd' })).status, 404)
    assert.equal((await call(port, { path: '/chunks/x.js.map' })).status, 404)
    assert.equal((await call(port, { path: '/chunks/sub/x.js' })).status, 404)
  })

  it('serves the brotli copy only to browsers that accept it, and never an unlisted file', async () => {
    const plain = await call(port, { path: '/app.css' })
    assert.equal(plain.body, 'body{color:red}')
    assert.equal(plain.headers['content-encoding'], undefined)
    const br = await new Promise<{ encoding: string | undefined; body: Buffer }>((resolve, reject) => {
      const req = request({ host: '127.0.0.1', port, path: '/app.css', headers: { 'Accept-Encoding': 'gzip, br' } }, (res) => {
        const chunks: Buffer[] = []
        res.on('data', (c: Buffer) => chunks.push(c))
        res.on('end', () => resolve({ encoding: res.headers['content-encoding'] as string | undefined, body: Buffer.concat(chunks) }))
      })
      req.on('error', reject)
      req.end()
    })
    assert.equal(br.encoding, 'br')
    assert.equal(brotliDecompressSync(br.body).toString(), 'body{color:red}')
    // index.html has no .br copy: falls back to the plain file
    assert.equal((await call(port, { path: '/', headers: { 'Accept-Encoding': 'br' } })).status, 200)
    assert.equal((await call(port, { path: '/secret.txt.br', headers: { 'Accept-Encoding': 'br' } })).status, 404)
    assert.equal((await call(port, { path: '/secret.txt', headers: { 'Accept-Encoding': 'br' } })).status, 404)
  })

  it('reads Accept-Encoding, honoring q=0', () => {
    assert.equal(acceptsBrotli('gzip, deflate, br'), true)
    assert.equal(acceptsBrotli('br;q=0'), false)
    assert.equal(acceptsBrotli('gzip'), false)
    assert.equal(acceptsBrotli(undefined), false)
  })

  it('non-GET static requests → 405', async () => {
    assert.equal((await call(port, { method: 'POST', path: '/' })).status, 405)
  })

  it('streams deltas over /api/events', async () => {
    const received = await new Promise<string>((resolve, reject) => {
      const req = request({ host: '127.0.0.1', port, path: '/api/events', headers: auth() }, (res) => {
        assert.equal(res.statusCode, 200)
        let text = ''
        res.on('data', (chunk: Buffer) => {
          text += chunk.toString('utf8')
          if (text.includes('event: hello') && !text.includes('event: delta')) {
            fake.ctx.store.emit({ ts: 1, kind: 'tool.called', source: 'hook', entityId: 'x', summary: 'stream test' })
            fake.ctx.store.flushNow()
          }
          if (text.includes('event: delta')) {
            req.destroy()
            resolve(text)
          }
        })
      })
      req.on('error', (error) => ((error as NodeJS.ErrnoException).code === 'ECONNRESET' ? undefined : reject(error)))
      req.end()
    })
    assert.match(received, /stream test/)
  })
})

describe('DashboardServer lifecycle', () => {
  it('moves to the next port when the first is busy and stop() frees it', async () => {
    const base = 48900 + Math.floor(Math.random() * 500)
    const deps = { uiDir: '/nonexistent', token: newToken(), port: base, allowControls: () => false, snapshot: () => ({ state: {} as never, events: [] }), subscribe: () => () => {}, command: async () => ({ ok: true as const, result: null }), log: () => {} }
    const first = new DashboardServer(deps)
    const second = new DashboardServer(deps)
    await first.start()
    await second.start()
    try {
      assert.equal(new URL(first.url!).port, String(base))
      assert.equal(new URL(second.url!).port, String(base + 1))
    } finally {
      await first.stop()
      await second.stop()
    }
    assert.equal(first.url, null)
  })
})
