import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { AgentsAdapter, mapState } from '../src/worker/adapters/agents-adapter.ts'
import { newAgent } from '../src/worker/context.ts'
import { makeContext } from './helpers/fake-context.ts'

type Status = Parameters<AgentsAdapter['onStatus']>[0]

function status(overrides: Partial<Status> = {}): Status {
  return { workspaceId: 'ws-raw', paneKey: 'pane-1', terminalId: 't1', title: 'Claude', state: 'working', receivedAt: 1000, ...overrides }
}

describe('AgentsAdapter.onStatus', () => {
  it('creates a live term:<id> agent and emits agent.started', () => {
    const { ctx } = makeContext()
    new AgentsAdapter(ctx).onStatus(status({ sessionId: 's1' }))
    const agent = ctx.store.read().agents['term:t1']
    assert.ok(agent)
    assert.equal(agent.role, 'agent')
    assert.equal(agent.state, 'working')
    assert.equal(agent.live, true)
    assert.equal(agent.paneKey, 'pane-1')
    assert.equal(agent.sessionId, 's1')
    assert.equal(agent.workspaceId, 'ws-raw')
    assert.equal(agent.startedAt, 1000)
    assert.equal(agent.endedAt, null)
    assert.deepEqual(agent.evidence, ['host-event'])
    const events = ctx.store.events()
    assert.equal(events.length, 1)
    assert.equal(events[0].kind, 'agent.started')
    assert.equal(ctx.identity.resolve({ paneKey: 'pane-1' }), 'term:t1')
    assert.equal(ctx.identity.resolve({ sessionId: 's1' }), 'term:t1')
  })

  it('falls back to pane:<key> without a terminal id', () => {
    const { ctx } = makeContext()
    new AgentsAdapter(ctx).onStatus(status({ terminalId: undefined }))
    assert.ok(ctx.store.read().agents['pane:pane-1'])
  })

  it('emits agent.status_changed, then agent.completed when done (not live)', () => {
    const { ctx } = makeContext()
    const adapter = new AgentsAdapter(ctx)
    adapter.onStatus(status())
    adapter.onStatus(status({ state: 'blocked', receivedAt: 2000 }))
    adapter.onStatus(status({ state: 'blocked', receivedAt: 2500 }))
    adapter.onStatus(status({ state: 'done', receivedAt: 3000 }))
    const kinds = ctx.store.events().map((e) => e.kind)
    assert.deepEqual(kinds, ['agent.started', 'agent.status_changed', 'agent.completed'])
    const agent = ctx.store.read().agents['term:t1']
    assert.equal(agent.state, 'done')
    assert.equal(agent.live, false)
    assert.equal(agent.endedAt, 3000)
    assert.equal(agent.startedAt, 1000)
  })

  it('a failure outcome maps to failed', () => {
    const { ctx } = makeContext()
    const adapter = new AgentsAdapter(ctx)
    adapter.onStatus(status())
    adapter.onStatus(status({ state: 'done', receivedAt: 2000, mainAgent: { state: 'done', outcome: 'failure', stateStartedAt: 1900 } }))
    const agent = ctx.store.read().agents['term:t1']
    assert.equal(agent.state, 'failed')
    assert.equal(agent.outcome, 'failure')
    assert.equal(agent.live, false)
    assert.equal(agent.stateSince, 1900)
    assert.equal(ctx.store.events().at(-1)?.kind, 'agent.failed')
  })

  it('mainAgent state wins over the pane state', () => {
    const { ctx } = makeContext()
    new AgentsAdapter(ctx).onStatus(status({ state: 'working', mainAgent: { state: 'waiting', stateStartedAt: 900 } }))
    assert.equal(ctx.store.read().agents['term:t1'].state, 'waiting')
    assert.equal(ctx.store.read().agents['term:t1'].live, true)
  })

  it('an older status event does not overwrite a newer one', () => {
    const { ctx } = makeContext()
    const adapter = new AgentsAdapter(ctx)
    adapter.onStatus(status({ state: 'done', receivedAt: 5000 }))
    adapter.onStatus(status({ state: 'working', receivedAt: 4000 }))
    assert.equal(ctx.store.read().agents['term:t1'].state, 'done')
  })

  it('merges into an existing dispatch agent linked by pane key', () => {
    const { ctx } = makeContext()
    const dispatch = newAgent('dispatch:ctx_1', 'worker', 0)
    ctx.store.upsertAgent('dispatch:ctx_1', 1, { dispatchId: 'ctx_1', paneKey: 'pane-1', runId: 'run_1', title: 'API review', state: 'working', live: true }, () => dispatch)
    ctx.identity.link('dispatch:ctx_1', { paneKey: 'pane-1' })
    new AgentsAdapter(ctx).onStatus(status({ state: 'blocked', receivedAt: 2000 }))
    const agents = ctx.store.read().agents
    assert.equal(agents['term:t1'], undefined)
    const merged = agents['dispatch:ctx_1']
    assert.equal(merged.state, 'blocked')
    assert.equal(merged.terminalId, 't1')
    assert.equal(merged.role, 'worker')
    assert.ok(merged.evidence.includes('host-event'))
    const event = ctx.store.events().at(-1)
    assert.equal(event?.kind, 'agent.status_changed')
    assert.equal(event?.runId, 'run_1')
    assert.equal(ctx.identity.resolve({ terminalId: 't1' }), 'dispatch:ctx_1')
  })

  it('uses the known worktree for workspaceListId', () => {
    const { ctx } = makeContext()
    ctx.store.put({ entity: 'worktree', id: 'wl1', value: { id: 'wl1', name: 'wt', path: '/repo/wt', branch: 'feat/x', project: null, projectId: null, hostId: null, kind: 'worktree', status: null, terminalCount: null, lastActivityAt: null, version: 1 } })
    new AgentsAdapter(ctx).onStatus(status({ workspaceListId: 'wl1' }))
    const agent = ctx.store.read().agents['term:t1']
    assert.equal(agent.workspaceId, 'wl1')
    assert.equal(agent.worktreePath, '/repo/wt')
    assert.equal(agent.branch, 'feat/x')
  })
})

describe('AgentsAdapter.scan', () => {
  it('lists workspaces and their agents through the host API', async () => {
    const workspaces = [
      { id: 'w1', name: 'main', path: '/repo', branch: 'main', project: 'repo', projectId: 'p1', hostId: 'local', kind: 'worktree', status: { state: 'active', terminalCount: 1, lastActivityAt: 5 } },
      { id: 'w2', name: 'idle', path: '/repo2', branch: null, hostId: 'local', kind: 'folder', status: { state: 'inactive', terminalCount: 0, lastActivityAt: 1 } }
    ]
    const { ctx, host } = makeContext({
      host: {
        'workspace.list': () => ({ workspaces, truncated: false }),
        'agents.list': () => ({ agents: [{ terminalId: 't9', title: 'Claude', agent: 'claude', state: 'working', stateStartedAt: 100, sessionId: 's9', task: { title: 'Fix bug' } }] })
      }
    })
    const adapter = new AgentsAdapter(ctx)
    await adapter.scan()
    const state = ctx.store.read()
    assert.deepEqual(Object.keys(state.worktrees).sort(), ['w1', 'w2'])
    assert.equal(adapter.worktreeForPath('/repo')?.id, 'w1')
    assert.deepEqual(host.callsTo('agents.list'), [{ workspaceId: 'w1' }])
    const agent = state.agents['term:t9']
    assert.equal(agent.agent, 'claude')
    assert.equal(agent.description, 'Fix bug')
    assert.equal(agent.workspaceId, 'w1')
    assert.equal(agent.live, true)
    assert.ok(ctx.store.hasEvent('agent.created', 'term:t9'))
    assert.ok(ctx.store.hasEvent('worktree.created', 'w1'))
  })
})

describe('mapState', () => {
  it('maps failure/interruption outcomes of done to failed', () => {
    assert.equal(mapState('done', 'failure'), 'failed')
    assert.equal(mapState('done', 'interruption'), 'failed')
    assert.equal(mapState('done', 'success'), 'done')
    assert.equal(mapState('done'), 'done')
    assert.equal(mapState('working', 'failure'), 'working')
  })
})
