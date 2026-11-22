// The repository a worktree belongs to, from its `.git` pointer (read-only, no git process):
// a linked worktree has a `.git` file `gitdir: <repo>/.git/worktrees/<name>`; a main checkout
// has a `.git` folder. Lets project boxes match a worktree to its project exactly.
import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'

const cache = new Map<string, string | null>()

export async function repoRootOf(worktreePath: string): Promise<string | null> {
  if (cache.has(worktreePath)) return cache.get(worktreePath)!
  let root: string | null = null
  try {
    const dotGit = join(worktreePath, '.git')
    const info = await stat(dotGit)
    if (info.isDirectory()) root = worktreePath
    else {
      const text = await readFile(dotGit, 'utf8')
      const gitdir = /^gitdir:\s*(.+)$/m.exec(text)?.[1]?.trim()
      const marker = gitdir ? gitdir.lastIndexOf('/.git/') : -1
      if (gitdir && marker > 0) root = gitdir.slice(0, marker)
    }
  } catch {
    root = null // removed worktree or not a git checkout
  }
  cache.set(worktreePath, root)
  if (cache.size > 2000) cache.delete(cache.keys().next().value as string)
  return root
}
