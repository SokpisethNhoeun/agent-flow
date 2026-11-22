// EXPERIMENTAL: a minimal client of Orca's local runtime RPC, the same private Unix socket and
// line protocol the `orca` CLI uses. It exists only because Orca's plugin API cannot yet send a
// message into a chat session (see upstream/PR.md for the official API this should become).
//
// Hard limits: only the methods in ALLOWED can be called; the auth token is read from Orca's own
// runtime metadata file, kept in memory only, and never logged, returned or sent anywhere else.
// Every failure is reported as such; nothing is retried blindly.
import { createConnection } from 'node:net'
import { randomUUID } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import { homedir, platform } from 'node:os'
import { join } from 'node:path'

const ALLOWED = new Set(['agentSession.history', 'agentSession.send'])
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024
const METADATA_FILE = 'orca-runtime.json'

export class RuntimeRpcError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message)
  }
}

type Metadata = { authToken: string; transports: { kind: string; endpoint: string }[] }

export function orcaUserDataDir(): string {
  const home = homedir()
  if (process.env.ORCA_USER_DATA_PATH) return process.env.ORCA_USER_DATA_PATH
  if (platform() === 'darwin') return join(home, 'Library/Application Support/orca')
  if (platform() === 'win32') return join(process.env.APPDATA ?? join(home, 'AppData/Roaming'), 'orca')
  return join(process.env.XDG_CONFIG_HOME ?? join(home, '.config'), 'orca')
}

async function readMetadata(dir: string): Promise<Metadata> {
  const path = join(dir, METADATA_FILE)
  try {
    // Refuse a metadata file other users could have written.
    const info = await stat(path)
    if (platform() !== 'win32' && typeof process.getuid === 'function' && info.uid !== process.getuid()) throw new RuntimeRpcError('runtime_untrusted', 'Orca runtime metadata is not owned by this user.')
    const parsed = JSON.parse(await readFile(path, 'utf8')) as Partial<Metadata>
    if (!parsed.authToken || !Array.isArray(parsed.transports)) throw new RuntimeRpcError('runtime_unavailable', 'Orca runtime metadata is incomplete.')
    return parsed as Metadata
  } catch (error) {
    if (error instanceof RuntimeRpcError) throw error
    throw new RuntimeRpcError('runtime_unavailable', 'Could not read Orca runtime metadata. Is Orca running?')
  }
}

export async function callOrcaRuntime<T>(method: string, params: unknown, options: { timeoutMs?: number; userDataDir?: string } = {}): Promise<T> {
  if (!ALLOWED.has(method)) throw new RuntimeRpcError('not_permitted', `Agent Flow does not call ${method}.`)
  const metadata = await readMetadata(options.userDataDir ?? orcaUserDataDir())
  const transport = metadata.transports.find((t) => t.kind === 'unix' || t.kind === 'named-pipe')
  if (!transport) throw new RuntimeRpcError('runtime_unavailable', 'Orca exposes no local runtime socket.')
  const id = randomUUID()
  return await new Promise<T>((resolve, reject) => {
    const socket = createConnection(transport.endpoint)
    let buffer = ''
    let size = 0
    let done = false
    const finish = (fn: () => void) => {
      if (done) return
      done = true
      clearTimeout(timer)
      socket.destroy()
      fn()
    }
    const timer = setTimeout(() => finish(() => reject(new RuntimeRpcError('timeout', 'Orca did not answer in time.'))), options.timeoutMs ?? 15000)
    socket.on('error', () => finish(() => reject(new RuntimeRpcError('runtime_unavailable', 'Could not reach Orca’s runtime.'))))
    socket.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_RESPONSE_BYTES) return finish(() => reject(new RuntimeRpcError('too_large', 'Orca’s answer was too large.')))
      buffer += chunk.toString('utf8')
      let index: number
      while ((index = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, index)
        buffer = buffer.slice(index + 1)
        if (!line.trim()) continue
        let frame: { id?: string; ok?: boolean; result?: T; error?: { code?: string; message?: string }; _keepalive?: unknown }
        try {
          frame = JSON.parse(line)
        } catch {
          return finish(() => reject(new RuntimeRpcError('invalid_response', 'Orca sent an unreadable answer.')))
        }
        if (frame._keepalive !== undefined) {
          timer.refresh()
          continue
        }
        if (frame.id !== id) return finish(() => reject(new RuntimeRpcError('invalid_response', 'Orca answered a different request.')))
        if (frame.ok) return finish(() => resolve(frame.result as T))
        return finish(() => reject(new RuntimeRpcError(frame.error?.code ?? 'action_failed', frame.error?.message ?? 'Orca refused the request.')))
      }
    })
    socket.write(JSON.stringify({ id, authToken: metadata.authToken, method, params }) + '\n')
  })
}
