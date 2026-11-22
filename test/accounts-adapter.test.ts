import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { AccountsAdapter } from '../src/worker/adapters/accounts-adapter.ts'
import { EMPTY_LABELS } from '../src/shared/model.ts'
import { makeContext } from './helpers/fake-context.ts'
import { makeAgent, tempDir } from './helpers/fixtures.ts'

describe('AccountsAdapter', () => {
  let dir = ''
  let home = ''
  let cleanup: () => Promise<void> = async () => {}

  before(async () => {
    ;({ dir, cleanup } = await tempDir())
    home = join(dir, 'acc1', 'home')
    await mkdir(join(home, 'sessions'), { recursive: true })
    await writeFile(join(home, 'sessions', '123.json'), JSON.stringify({ sessionId: 's1', pid: 123 }))
    await writeFile(join(home, 'sessions', 'notes.json'), JSON.stringify({ sessionId: 'ignored' }))
    await writeFile(join(home, 'sessions', '456.json'), '{partial')
  })
  after(() => cleanup())

  function setup(extraAgents = [makeAgent('term:a', { sessionId: 's1' })]) {
    const fake = makeContext({
      cli: { 'account list': { claude: { accounts: [{ id: 'acc1', email: 'a@example.com', home }], activeAccountId: 'acc1' }, codex: { accounts: [] } } }
    })
    for (const agent of extraAgents) fake.ctx.store.upsertAgent(agent.id, 1, agent, () => agent)
    return { ...fake, adapter: new AccountsAdapter(fake.ctx) }
  }

  it('loads accounts from `orca account list`', async () => {
    const { adapter, ctx } = setup([])
    await adapter.refresh()
    assert.deepEqual(ctx.store.read().accounts.acc1, { id: 'acc1', provider: 'claude', email: 'a@example.com', label: null, active: true })
  })

  it('maps an agent to its account through the session file', async () => {
    const { adapter, ctx } = setup()
    await adapter.refresh()
    const agent = ctx.store.read().agents['term:a']
    assert.deepEqual(agent.account, { accountId: 'acc1', label: 'a@example.com', provider: 'claude', source: 'session-file' })
    assert.ok(agent.evidence.includes('session-file'))
  })

  it('uses labels.accountTeams for the label (by id or by email)', async () => {
    const byId = setup()
    byId.ctx.store.put({ entity: 'labels', id: 'labels', value: { ...EMPTY_LABELS, accountTeams: { acc1: 'Team A' } } })
    await byId.adapter.refresh()
    assert.equal(byId.ctx.store.read().agents['term:a'].account?.label, 'Team A')
    assert.equal(byId.ctx.store.read().accounts.acc1.label, 'Team A')

    const byEmail = setup()
    byEmail.ctx.store.put({ entity: 'labels', id: 'labels', value: { ...EMPTY_LABELS, accountTeams: { 'a@example.com': 'Team B' } } })
    await byEmail.adapter.refresh()
    assert.equal(byEmail.ctx.store.read().agents['term:a'].account?.label, 'Team B')
  })

  it('maps a terminal to an account from the launch env when no session matches', async () => {
    const { adapter, ctx } = setup([makeAgent('term:t7', { terminalId: 't7', sessionId: 'unknown-session' })])
    await adapter.refresh()
    assert.equal(ctx.store.read().agents['term:t7'].account, null)
    adapter.onLaunch({ agent: 'claude', terminalId: 't7', env: { CLAUDE_CONFIG_DIR: home } })
    adapter.applyToAgents()
    assert.deepEqual(ctx.store.read().agents['term:t7'].account, { accountId: 'acc1', label: 'a@example.com', provider: 'claude', source: 'launch-capture' })
  })

  it('the session file wins over the launch capture', async () => {
    const { adapter, ctx } = setup([makeAgent('term:t8', { terminalId: 't8', sessionId: 's1' })])
    await adapter.refresh()
    adapter.onLaunch({ agent: 'claude', terminalId: 't8', env: { CLAUDE_CONFIG_DIR: home } })
    adapter.applyToAgents()
    assert.equal(ctx.store.read().agents['term:t8'].account?.source, 'session-file')
  })

  it('ignores launches without a terminal or a known profile dir', async () => {
    const { adapter, ctx } = setup([makeAgent('term:t9', { terminalId: 't9' })])
    await adapter.refresh()
    adapter.onLaunch({ agent: 'claude', env: { CLAUDE_CONFIG_DIR: home } })
    adapter.onLaunch({ agent: 'claude', terminalId: 't9', env: { CLAUDE_CONFIG_DIR: join(dir, 'elsewhere') } })
    adapter.applyToAgents()
    assert.equal(ctx.store.read().agents['term:t9'].account, null)
  })

  it('accountForProfileDir matches the home, its parent and subfolders', async () => {
    const { adapter } = setup([])
    await adapter.refresh()
    assert.equal(adapter.accountForProfileDir(home), 'acc1')
    assert.equal(adapter.accountForProfileDir(join(dir, 'acc1')), 'acc1')
    assert.equal(adapter.accountForProfileDir(join(home, '.claude')), 'acc1')
    assert.equal(adapter.accountForProfileDir(join(dir, 'acc2')), null)
  })

  it('subagents inherit their parent account', async () => {
    const parent = makeAgent('term:p', { sessionId: 's1' })
    const sub = makeAgent('sub:c', { role: 'subagent', parentId: 'term:p' })
    const { adapter, ctx } = setup([parent, sub])
    await adapter.refresh()
    adapter.applyToAgents()
    assert.equal(ctx.store.read().agents['sub:c'].account?.accountId, 'acc1')
  })

  it('removes accounts that are no longer listed and logs CLI failures', async () => {
    const { adapter, ctx, cli, logs } = setup([])
    await adapter.refresh()
    cli.set('account list', { claude: { accounts: [] } })
    await adapter.refresh()
    assert.equal(ctx.store.read().accounts.acc1, undefined)
    cli.set('account list', () => ({ ok: false, code: 'unavailable', message: 'nope' }))
    await adapter.refresh()
    assert.match(logs.join('\n'), /account list: unavailable nope/)
  })
})

describe('AccountsAdapter liveness from session files', () => {
  it('marks an agent live only while its session pid runs', async () => {
    const { dir, cleanup } = await tempDir()
    try {
      const home = join(dir, 'acc', 'home')
      await mkdir(join(home, 'sessions'), { recursive: true })
      // This test process is certainly alive; pid 2**30 is certainly not.
      await writeFile(join(home, 'sessions', 'a.json'.replace('a', String(process.pid))), JSON.stringify({ sessionId: 'alive', pid: process.pid, status: 'busy', updatedAt: 10 }))
      await writeFile(join(home, 'sessions', '1073741824.json'), JSON.stringify({ sessionId: 'dead', pid: 2 ** 30, status: 'busy', updatedAt: 10 }))
      const fake = makeContext({ cli: { 'account list': { claude: { accounts: [{ id: 'acc', email: 'a@example.com', home }], activeAccountId: 'acc' } } } })
      for (const [id, sessionId] of [['term:1', 'alive'], ['term:2', 'dead']]) {
        const agent = makeAgent(id, { sessionId, state: 'unknown', live: false })
        fake.ctx.store.upsertAgent(id, 1, agent, () => agent)
      }
      await new AccountsAdapter(fake.ctx).refresh()
      const agents = fake.ctx.store.read().agents
      assert.equal(agents['term:1'].live, true)
      assert.equal(agents['term:1'].state, 'working')
      assert.equal(agents['term:2'].live, false)
      assert.equal(agents['term:2'].state, 'done')
    } finally {
      await cleanup()
    }
  })
})

describe('processAlive', () => {
  it('rejects a reused pid whose start time differs from the session file', async () => {
    const { processAlive } = await import('../src/worker/adapters/accounts-adapter.ts')
    assert.equal(await processAlive(process.pid, null), true)
    if (process.platform === 'linux') assert.equal(await processAlive(process.pid, '1'), false)
    assert.equal(await processAlive(2 ** 30, null), false)
  })
})
