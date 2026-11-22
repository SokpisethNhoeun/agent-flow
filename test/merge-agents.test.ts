import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { newAgent } from '../src/worker/context.ts'
import { IdentityIndex } from '../src/worker/state/identity-index.ts'
import { mergeDuplicatesOf } from '../src/worker/state/merge-agents.ts'
import { FlowStore } from '../src/worker/state/store.ts'

const SESSION = 'structured-agent-session-0e135640-3071-4511-a865-ffcc1a669110'

describe('mergeDuplicatesOf', () => {
  it('folds a status-event record into its orchestration dispatch, keeping what it learned', () => {
    const store = new FlowStore(0)
    const identity = new IdentityIndex()
    store.upsertAgent('pane:x', 100, { role: 'agent', paneKey: `${SESSION}:aaa`, sessionId: 's1', tokens: 42, state: 'working', live: true, account: { accountId: 'acc', label: 'Team A', provider: 'claude', source: 'session-file' } }, () => newAgent('pane:x', 'agent', 100))
    store.upsertAgent('sub:1', 101, { role: 'subagent', parentId: 'pane:x' }, () => newAgent('sub:1', 'subagent', 101))
    store.upsertAgent('dispatch:ctx_1', 50, { role: 'worker', dispatchId: 'ctx_1', paneKey: `${SESSION}:bbb`, model: 'claude-haiku-5-5' }, () => newAgent('dispatch:ctx_1', 'worker', 50))
    mergeDuplicatesOf(store, identity, 'dispatch:ctx_1')
    const agents = store.read().agents
    assert.equal(agents['pane:x'], undefined)
    const merged = agents['dispatch:ctx_1']
    assert.equal(merged.sessionId, 's1')
    assert.equal(merged.tokens, 42)
    assert.equal(merged.account?.label, 'Team A')
    assert.equal(merged.model, 'claude-haiku-5-5')
    assert.equal(merged.state, 'working')
    assert.equal(merged.live, true)
    assert.equal(agents['sub:1'].parentId, 'dispatch:ctx_1')
    assert.equal(identity.resolve({ sessionId: 's1' }), 'dispatch:ctx_1')
  })

  it('leaves agents in other sessions alone', () => {
    const store = new FlowStore(0)
    const identity = new IdentityIndex()
    store.upsertAgent('pane:y', 1, { role: 'agent', paneKey: 'structured-agent-session-other:1' }, () => newAgent('pane:y', 'agent', 1))
    store.upsertAgent('dispatch:ctx_2', 1, { role: 'worker', dispatchId: 'ctx_2', paneKey: `${SESSION}:2` }, () => newAgent('dispatch:ctx_2', 'worker', 1))
    mergeDuplicatesOf(store, identity, 'dispatch:ctx_2')
    assert.ok(store.read().agents['pane:y'])
  })
})

describe('dedupeAgent', () => {
  it('folds a plain terminal record into the dispatch that owns the same terminal', async () => {
    const { dedupeAgent } = await import('../src/worker/state/merge-agents.ts')
    const store = new FlowStore(0)
    const identity = new IdentityIndex()
    store.upsertAgent('dispatch:ctx_9', 1, { role: 'worker', dispatchId: 'ctx_9', terminalId: 't9' }, () => newAgent('dispatch:ctx_9', 'worker', 1))
    store.upsertAgent('term:t9', 5, { role: 'agent', terminalId: 't9', live: true, state: 'working' }, () => newAgent('term:t9', 'agent', 5))
    const survivor = dedupeAgent(store, identity, 'term:t9')
    assert.equal(survivor, 'dispatch:ctx_9')
    assert.equal(store.read().agents['term:t9'], undefined, 'no orphan stays live')
    assert.equal(store.read().agents['dispatch:ctx_9'].live, true)
  })

  it('never merges two different dispatches (two attempts of a task)', async () => {
    const { dedupeAgent } = await import('../src/worker/state/merge-agents.ts')
    const store = new FlowStore(0)
    const identity = new IdentityIndex()
    store.upsertAgent('dispatch:a', 1, { role: 'worker', dispatchId: 'a', sessionId: 's' }, () => newAgent('dispatch:a', 'worker', 1))
    store.upsertAgent('dispatch:b', 1, { role: 'worker', dispatchId: 'b', sessionId: 's' }, () => newAgent('dispatch:b', 'worker', 1))
    dedupeAgent(store, identity, 'dispatch:a')
    assert.ok(store.read().agents['dispatch:a'] && store.read().agents['dispatch:b'])
  })
})
