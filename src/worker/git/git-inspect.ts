// Read-only Git inspection of a worktree Orca already knows about. Never writes, merges or pushes.
import { execFile } from 'node:child_process'
import { redact, truncate } from '../../shared/redact.ts'

export type GitInspection = {
  path: string
  branch: string | null
  head: string | null
  changedFiles: { status: string; path: string }[]
  diffStat: string
  commits: { hash: string; subject: string; author: string; at: number }[]
  conflicts: string[]
  ahead: number | null
  behind: number | null
}

function git(cwd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('git', ['-C', cwd, '--no-optional-locks', ...args], { timeout: 8000, maxBuffer: 4 * 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' } }, (error, stdout) =>
      error ? reject(error) : resolve(stdout)
    )
  })
}

export async function inspectWorktree(path: string): Promise<GitInspection> {
  const [branch, head, status, diffStat, log, upstream] = await Promise.all([
    git(path, ['rev-parse', '--abbrev-ref', 'HEAD']).catch(() => ''),
    git(path, ['rev-parse', '--short', 'HEAD']).catch(() => ''),
    git(path, ['status', '--porcelain=v1', '-uall']).catch(() => ''),
    git(path, ['diff', '--stat', 'HEAD']).catch(() => ''),
    git(path, ['log', '-n', '20', '--format=%h%x1f%s%x1f%an%x1f%ct']).catch(() => ''),
    git(path, ['rev-list', '--left-right', '--count', 'HEAD...@{upstream}']).catch(() => '')
  ])
  const changedFiles = status
    .split('\n')
    .filter(Boolean)
    .slice(0, 500)
    .map((line) => ({ status: line.slice(0, 2).trim() || '?', path: line.slice(3) }))
  const conflicts = changedFiles.filter((file) => ['UU', 'AA', 'DD', 'AU', 'UA', 'DU', 'UD'].includes(file.status)).map((file) => file.path)
  const commits = log
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [hash, subject, author, ct] = line.split('\x1f')
      return { hash, subject: redact(subject ?? ''), author: author ?? '', at: Number(ct) * 1000 }
    })
  const [ahead, behind] = upstream.trim() ? upstream.trim().split(/\s+/).map(Number) : [null, null]
  return {
    path,
    branch: branch.trim() || null,
    head: head.trim() || null,
    changedFiles,
    diffStat: truncate(diffStat.trim(), 8000),
    commits,
    conflicts,
    ahead: Number.isFinite(ahead) ? ahead : null,
    behind: Number.isFinite(behind) ? behind : null
  }
}
