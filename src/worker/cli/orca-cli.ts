// Runs the documented `orca` CLI with --json. Never a shell: arguments go straight to execFile,
// so task titles and specs cannot inject commands.
import { execFile } from 'node:child_process'
import { access, constants, readFile } from 'node:fs/promises'
import { homedir, platform } from 'node:os'
import { delimiter, join } from 'node:path'

export type CliResult<T> = { ok: true; result: T } | { ok: false; code: string; message: string }

export type CliRunner = {
  readonly path: string | null
  run<T = unknown>(args: string[], options?: { timeoutMs?: number; stdin?: string }): Promise<CliResult<T>>
}

const MAX_CONCURRENT = 3
const MAX_OUTPUT = 8 * 1024 * 1024

/**
 * Finds the Orca IDE CLI. On many Linux desktops `/usr/bin/orca` is the GNOME *screen reader*,
 * so every candidate is checked by content and then confirmed with `orca status --json`.
 */
export async function resolveCliPath(override: string | null): Promise<string | null> {
  const home = homedir()
  const candidates: string[] = []
  if (override) candidates.push(override)
  if (platform() === 'linux') candidates.push(join(home, '.config/orca/linux-orca-cli-shim/orca'))
  const exe = platform() === 'win32' ? ['orca.cmd', 'orca.exe', 'orca'] : ['orca']
  for (const dir of (process.env.PATH ?? '').split(delimiter)) for (const name of exe) if (dir) candidates.push(join(dir, name))
  if (platform() === 'darwin') candidates.push('/usr/local/bin/orca', '/opt/homebrew/bin/orca', '/Applications/Orca.app/Contents/Resources/bin/orca')
  if (platform() === 'win32') candidates.push(join(process.env.LOCALAPPDATA ?? join(home, 'AppData/Local'), 'Programs/Orca/resources/bin/orca.cmd'))
  if (platform() === 'linux') candidates.push('/usr/local/bin/orca')
  for (const candidate of [...new Set(candidates)]) {
    try {
      await access(candidate, platform() === 'win32' ? constants.F_OK : constants.X_OK)
    } catch {
      continue
    }
    if (await looksLikeScreenReader(candidate)) continue
    if (await confirmsOrcaIde(candidate)) return candidate
  }
  return null
}

/** The GNOME screen reader is a Python script; never execute it. */
export async function looksLikeScreenReader(path: string): Promise<boolean> {
  try {
    const head = (await readFile(path)).subarray(0, 2048).toString('latin1')
    return /^#!.*python/.test(head) || /The Orca Team|GNOME|Igalia|orca\.orca_main/.test(head)
  } catch {
    return false
  }
}

function confirmsOrcaIde(path: string): Promise<boolean> {
  return new Promise((resolve) => {
    execFile(path, ['status', '--json'], { timeout: 6000, maxBuffer: 1024 * 1024, windowsHide: true }, (_error, stdout) => {
      const parsed = parseCliOutput<{ app?: unknown }>(stdout ?? '', null)
      resolve(parsed.ok && typeof parsed.result === 'object' && parsed.result !== null && 'app' in parsed.result)
    })
  })
}

export function createCliRunner(path: string | null): CliRunner {
  let active = 0
  const queue: (() => void)[] = []
  const acquire = () =>
    new Promise<void>((resolve) => {
      if (active < MAX_CONCURRENT) {
        active++
        resolve()
      } else queue.push(() => { active++; resolve() })
    })
  const release = () => {
    active--
    queue.shift()?.()
  }

  return {
    path,
    async run<T>(args: string[], options: { timeoutMs?: number; stdin?: string } = {}): Promise<CliResult<T>> {
      if (!path) return { ok: false, code: 'cli_unavailable', message: 'The orca CLI was not found. Set its path in Agent Flow settings.' }
      await acquire()
      try {
        return await new Promise<CliResult<T>>((resolve) => {
          const child = execFile(
            path,
            [...args, '--json'],
            { timeout: options.timeoutMs ?? 15000, maxBuffer: MAX_OUTPUT, windowsHide: true, env: { ...process.env, NO_COLOR: '1' } },
            (error, stdout) => resolve(parseCliOutput<T>(stdout, error))
          )
          if (options.stdin !== undefined) {
            child.stdin?.end(options.stdin)
          } else child.stdin?.end()
        })
      } finally {
        release()
      }
    }
  }
}

/** The CLI prints `{ ok, result }` or `{ ok:false, error:{ code, message } }` even on non-zero exits. */
export function parseCliOutput<T>(stdout: string, error: (Error & { code?: unknown; killed?: boolean }) | null): CliResult<T> {
  const text = stdout.trim()
  const start = text.indexOf('{')
  if (start >= 0) {
    try {
      const parsed = JSON.parse(text.slice(start)) as { ok?: boolean; result?: T; error?: { code?: string; message?: string } }
      if (parsed.ok === true) return { ok: true, result: parsed.result as T }
      if (parsed.ok === false) return { ok: false, code: parsed.error?.code ?? 'action_failed', message: parsed.error?.message ?? 'The orca CLI reported an error.' }
    } catch {
      // fall through
    }
  }
  if (error?.killed) return { ok: false, code: 'timeout', message: 'The orca CLI did not answer in time.' }
  return { ok: false, code: 'action_failed', message: error?.message ?? 'The orca CLI returned no JSON.' }
}
