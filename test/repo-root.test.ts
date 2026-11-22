import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { repoRootOf } from '../src/worker/git/repo-root.ts'
import { tempDir } from './helpers/fixtures.ts'

describe('repoRootOf', () => {
  it('reads main checkouts, linked worktrees, and gives null for missing folders', async () => {
    const { dir, cleanup } = await tempDir()
    try {
      const repo = join(dir, 'repo')
      await mkdir(join(repo, '.git', 'worktrees', 'wt1'), { recursive: true })
      const wt = join(dir, 'wt1')
      await mkdir(wt)
      await writeFile(join(wt, '.git'), `gitdir: ${repo}/.git/worktrees/wt1\n`)
      assert.equal(await repoRootOf(repo), repo)
      assert.equal(await repoRootOf(wt), repo)
      assert.equal(await repoRootOf(join(dir, 'gone')), null)
    } finally {
      await cleanup()
    }
  })
})
