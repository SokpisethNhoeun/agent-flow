import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'
import { compareVersions, githubRepo, installedKey, UpdateChecker } from '../src/worker/update/update-check.ts'
import { tempDir } from './helpers/fixtures.ts'

test('knows an installed copy from a development folder', () => {
  assert.equal(installedKey('/home/me/.config/orca/plugins/sokpisethnhoeun.agent-flow/abc123'), 'sokpisethnhoeun.agent-flow')
  assert.equal(installedKey('C:\\Users\\me\\AppData\\Roaming\\orca\\plugins\\acme.agent-flow\\x'), 'acme.agent-flow')
  assert.equal(installedKey('/home/me/orca/projects/orca-improve'), null)
  assert.equal(installedKey('/home/me/.config/orca/plugins/local.agent-flow/dev'), null)
})

test('reads owner/repo and compares versions', () => {
  assert.equal(githubRepo('https://github.com/SokpisethNhoeun/agent-flow'), 'SokpisethNhoeun/agent-flow')
  assert.equal(githubRepo('https://evil.example/a/b'), null)
  assert.equal(compareVersions('0.1.10', '0.1.9'), 1)
  assert.equal(compareVersions('v1.0.0', '1.0.0'), 0)
  assert.equal(compareVersions('1.0.0-beta', '1.0.0'), -1)
  assert.equal(compareVersions('0.1.4', '0.1.5'), -1)
})

async function pluginDir(version: string) {
  const tmp = await tempDir()
  const root = join(tmp.dir, 'plugins', 'sokpisethnhoeun.agent-flow', 'h1')
  await mkdir(root, { recursive: true })
  await writeFile(join(root, 'orca-plugin.json'), JSON.stringify({ version, repository: 'https://github.com/SokpisethNhoeun/agent-flow' }))
  return { tmp, root }
}

test('reports a newer release, caches it, and stays quiet offline or when turned off', async () => {
  const { tmp, root } = await pluginDir('0.1.4')
  try {
    let calls = 0
    let enabled = true
    const fetcher = async () => (calls++, { ok: true, status: 200, json: async () => ({ tag_name: 'v0.1.5', html_url: 'https://github.com/SokpisethNhoeun/agent-flow/releases/tag/v0.1.5' }) })
    const checker = new UpdateChecker(root, () => enabled, fetcher)
    const info = await checker.check()
    assert.deepEqual(info, { current: '0.1.4', latest: '0.1.5', newer: true, releaseUrl: 'https://github.com/SokpisethNhoeun/agent-flow/releases/tag/v0.1.5', pluginKey: 'sokpisethnhoeun.agent-flow' })
    await checker.check()
    assert.equal(calls, 1, 'an update found is kept (6 hours)')
    enabled = false
    assert.equal((await checker.check(true)).newer, false, 'setting off: no request, no notice')
    assert.equal(calls, 1)
    const offline = new UpdateChecker(root, () => true, async () => { throw new Error('offline') })
    assert.equal((await offline.check()).newer, false)
    // No update yet: asked again after 10 minutes, so a fresh release shows up soon.
    let now = 0
    let tag = 'v0.1.4'
    let sameCalls = 0
    const sameVersion = new UpdateChecker(root, () => true, async () => (sameCalls++, { ok: true, status: 200, json: async () => ({ tag_name: tag }) }), () => now)
    assert.equal((await sameVersion.check()).newer, false)
    tag = 'v0.1.5'
    now = 5 * 60 * 1000
    assert.equal((await sameVersion.check()).newer, false, 'within 10 minutes: cached')
    now = 11 * 60 * 1000
    assert.equal((await sameVersion.check()).newer, true, 'after 10 minutes: the new release is found')
    assert.equal(sameCalls, 2)
  } finally {
    await tmp.cleanup()
  }
})

test('rechecks send the ETag, and a 304 answer reuses the last release', async () => {
  const { tmp, root } = await pluginDir('0.1.4')
  try {
    let now = 0
    const sent: (string | undefined)[] = []
    const fetcher = async (_url: string, init: { headers: Record<string, string> }) => {
      sent.push(init.headers['If-None-Match'])
      if (init.headers['If-None-Match'] === '"e1"') return { ok: false, status: 304, json: async () => ({}), headers: { get: () => '"e1"' } }
      return { ok: true, status: 200, json: async () => ({ tag_name: 'v0.1.4' }), headers: { get: (name: string) => (name === 'etag' ? '"e1"' : null) } }
    }
    const checker = new UpdateChecker(root, () => true, fetcher, () => now)
    assert.equal((await checker.check()).latest, '0.1.4')
    now = 11 * 60 * 1000
    const again = await checker.check()
    assert.deepEqual(sent, [undefined, '"e1"'])
    assert.equal(again.latest, '0.1.4', '304: same answer as before, not treated as a failure')
    assert.equal(again.newer, false)
  } finally {
    await tmp.cleanup()
  }
})

test('update runs orca plugin update, and hands back the approve command when Orca asks', async () => {
  const { tmp, root } = await pluginDir('0.1.4')
  try {
    const checker = new UpdateChecker(root, () => true)
    const calls: string[][] = []
    const ok = await checker.update({ path: 'orca', run: async (args: string[]) => (calls.push(args), { ok: true, result: { version: '0.1.5' } }) } as never)
    assert.deepEqual(calls[0], ['plugin', 'update', 'sokpisethnhoeun.agent-flow'])
    assert.deepEqual(ok, { updated: true, version: '0.1.5' })
    const needsApproval = await checker.update({ path: 'orca', run: async () => ({ ok: false, code: 'approval_required', message: 'Next step: To approve, run: orca plugin update sokpisethnhoeun.agent-flow --approve ap1-e85cd9e406f7fdf041eed76b0021e513' }) } as never)
    assert.deepEqual(needsApproval, { updated: false, approveCommand: 'orca plugin update sokpisethnhoeun.agent-flow --approve ap1-e85cd9e406f7fdf041eed76b0021e513', reason: 'The new version asks for more access, so Orca needs your approval.' })
    const dev = await new UpdateChecker('/home/me/code/agent-flow', () => true).update({ path: 'orca', run: async () => ({ ok: true, result: {} }) } as never)
    assert.equal(dev.updated, false)
  } finally {
    await tmp.cleanup()
  }
})
