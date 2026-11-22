// "A new version of Agent Flow is available": compares this copy's version with the newest GitHub
// release of the repository in its manifest, at most every 6 hours, and updates through Orca's own
// `orca plugin update`. Only installed copies (Orca's plugins folder) check; a development folder never
// does. Nothing personal is sent: one unauthenticated request for the public release list.
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { CliRunner } from '../cli/orca-cli.ts'

const CHECK_EVERY_MS = 6 * 60 * 60 * 1000
const FETCH_TIMEOUT_MS = 8000

export type UpdateInfo = { current: string; latest: string | null; newer: boolean; releaseUrl: string | null; pluginKey: string | null }

export type UpdateResult = { updated: true; version: string | null } | { updated: false; approveCommand: string | null; reason: string }

/** The key of an installed copy (`<publisher>.<id>`) from where it runs; null for a development folder. */
export function installedKey(rootDir: string): string | null {
  const match = rootDir.match(/[\\/]plugins[\\/]([a-z0-9][a-z0-9-]*\.[a-z0-9][a-z0-9-]*)(?:[\\/]|$)/i)
  return match && !match[1].startsWith('local.') ? match[1] : null
}

/** owner/repo from a GitHub repository URL. */
export function githubRepo(url: string | undefined): string | null {
  const match = url?.match(/^https:\/\/github\.com\/([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+?)(?:\.git)?\/?$/)
  return match ? `${match[1]}/${match[2]}` : null
}

/** Semantic version compare of `x.y.z` (a leading v is ignored); prerelease suffixes count as older. */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string) => {
    const [core, pre] = v.replace(/^v/i, '').split('-', 2)
    return { nums: core.split('.').map((n) => Number.parseInt(n, 10) || 0), pre: pre ?? null }
  }
  const x = parse(a)
  const y = parse(b)
  for (let i = 0; i < 3; i++) {
    const d = (x.nums[i] ?? 0) - (y.nums[i] ?? 0)
    if (d) return Math.sign(d)
  }
  if (x.pre === y.pre) return 0
  return x.pre === null ? 1 : y.pre === null ? -1 : x.pre < y.pre ? -1 : 1
}

type Fetcher = (url: string, init: { headers: Record<string, string>; signal: AbortSignal }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>

export class UpdateChecker {
  private cached: { at: number; info: UpdateInfo } | null = null
  private manifest: { version: string; repository?: string } | null = null

  constructor(
    private readonly rootDir: string,
    private readonly enabled: () => boolean,
    private readonly fetcher: Fetcher = fetch as unknown as Fetcher,
    private readonly now: () => number = Date.now
  ) {}

  private async readManifest(): Promise<{ version: string; repository?: string }> {
    this.manifest ??= JSON.parse(await readFile(join(this.rootDir, 'orca-plugin.json'), 'utf8')) as { version: string; repository?: string }
    return this.manifest
  }

  async check(force = false): Promise<UpdateInfo> {
    const manifest = await this.readManifest()
    const pluginKey = installedKey(this.rootDir)
    const base: UpdateInfo = { current: manifest.version, latest: null, newer: false, releaseUrl: null, pluginKey }
    const repo = githubRepo(manifest.repository)
    if (!pluginKey || !repo || !this.enabled()) return base
    if (!force && this.cached && this.now() - this.cached.at < CHECK_EVERY_MS) return this.cached.info
    try {
      const response = await this.fetcher(`https://api.github.com/repos/${repo}/releases/latest`, {
        headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'orca-agent-flow-update-check' },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
      })
      if (!response.ok) throw new Error(`GitHub answered ${response.status}`)
      const release = (await response.json()) as { tag_name?: unknown; html_url?: unknown; draft?: unknown; prerelease?: unknown }
      const tag = typeof release.tag_name === 'string' && /^v?\d+\.\d+\.\d+/.test(release.tag_name) ? release.tag_name.replace(/^v/i, '') : null
      const url = typeof release.html_url === 'string' && release.html_url.startsWith(`https://github.com/${repo}/`) ? release.html_url : null
      const info: UpdateInfo = { ...base, latest: tag, newer: Boolean(tag) && release.draft !== true && release.prerelease !== true && compareVersions(tag!, manifest.version) > 0, releaseUrl: url }
      this.cached = { at: this.now(), info }
      return info
    } catch {
      // Offline or rate-limited: say nothing, try again next time.
      this.cached = { at: this.now() - CHECK_EVERY_MS + 30 * 60 * 1000, info: base }
      return base
    }
  }

  /** Runs `orca plugin update <key>`. A version that needs new access returns Orca's approve command instead. */
  async update(cli: CliRunner): Promise<UpdateResult> {
    const key = installedKey(this.rootDir)
    if (!key) return { updated: false, approveCommand: null, reason: 'This is a development copy; update it from its folder.' }
    const result = await cli.run<{ version?: string }>(['plugin', 'update', key], { timeoutMs: 120_000 })
    if (result.ok) {
      this.cached = null
      return { updated: true, version: typeof result.result?.version === 'string' ? result.result.version : null }
    }
    const fingerprint = result.message.match(/--approve\s+(ap\d-[a-f0-9]{16,64})/)?.[1] ?? null
    return {
      updated: false,
      approveCommand: fingerprint ? `orca plugin update ${key} --approve ${fingerprint}` : null,
      reason: result.code === 'approval_required' || fingerprint ? 'The new version asks for more access, so Orca needs your approval.' : result.message
    }
  }
}
