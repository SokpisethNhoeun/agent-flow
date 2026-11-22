import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { IdentityIndex, normalizePaneKey } from '../src/worker/state/identity-index.ts'

describe('IdentityIndex', () => {
  it('resolves by each kind of key', () => {
    const index = new IdentityIndex()
    index.link('a', { paneKey: 'pane-1' })
    index.link('b', { terminalHandle: 'h1' })
    index.link('c', { terminalId: 't1' })
    index.link('d', { sessionId: 's1' })
    assert.equal(index.resolve({ paneKey: 'pane-1' }), 'a')
    assert.equal(index.resolve({ terminalHandle: 'h1' }), 'b')
    assert.equal(index.resolve({ terminalId: 't1' }), 'c')
    assert.equal(index.resolve({ sessionId: 's1' }), 'd')
    assert.equal(index.resolve({ terminalId: 'nope' }), null)
    assert.equal(index.resolve({}), null)
  })

  it('keys do not collide across kinds', () => {
    const index = new IdentityIndex()
    index.link('a', { terminalId: 'same' })
    assert.equal(index.resolve({ sessionId: 'same' }), null)
    assert.equal(index.resolve({ terminalHandle: 'same' }), null)
  })

  it('links several keys at once and resolves through any of them', () => {
    const index = new IdentityIndex()
    index.link('agent', { paneKey: 'p', terminalId: 't', sessionId: 's', terminalHandle: 'h' })
    for (const keys of [{ paneKey: 'p' }, { terminalId: 't' }, { sessionId: 's' }, { terminalHandle: 'h' }]) assert.equal(index.resolve(keys), 'agent')
  })

  it('resolve prefers pane, then handle, then terminal, then session', () => {
    const index = new IdentityIndex()
    index.link('by-session', { sessionId: 's' })
    index.link('by-terminal', { terminalId: 't' })
    index.link('by-handle', { terminalHandle: 'h' })
    index.link('by-pane', { paneKey: 'p' })
    assert.equal(index.resolve({ sessionId: 's', terminalId: 't', terminalHandle: 'h', paneKey: 'p' }), 'by-pane')
    assert.equal(index.resolve({ sessionId: 's', terminalId: 't', terminalHandle: 'h' }), 'by-handle')
    assert.equal(index.resolve({ sessionId: 's', terminalId: 't' }), 'by-terminal')
  })

  it('dispatch ids win over plain ids for the same key', () => {
    const index = new IdentityIndex()
    index.link('dispatch:ctx_1', { paneKey: 'pane-1', terminalHandle: 'h' })
    index.link('term:t1', { paneKey: 'pane-1', terminalId: 't1' })
    assert.equal(index.resolve({ paneKey: 'pane-1' }), 'dispatch:ctx_1')
    assert.equal(index.resolve({ terminalId: 't1' }), 'term:t1', 'new keys are still linked')
  })

  it('a dispatch id can replace a plain id', () => {
    const index = new IdentityIndex()
    index.link('term:t1', { terminalId: 't1' })
    index.link('dispatch:ctx_1', { terminalId: 't1' })
    assert.equal(index.resolve({ terminalId: 't1' }), 'dispatch:ctx_1')
  })

  it('later plain links overwrite earlier plain links', () => {
    const index = new IdentityIndex()
    index.link('term:a', { sessionId: 's' })
    index.link('term:b', { sessionId: 's' })
    assert.equal(index.resolve({ sessionId: 's' }), 'term:b')
  })

  it('unlinkAgent removes every key of that agent only', () => {
    const index = new IdentityIndex()
    index.link('a', { terminalId: 't', sessionId: 's' })
    index.link('b', { terminalId: 'u' })
    index.unlinkAgent('a')
    assert.equal(index.resolve({ terminalId: 't' }), null)
    assert.equal(index.resolve({ sessionId: 's' }), null)
    assert.equal(index.resolve({ terminalId: 'u' }), 'b')
  })

  it('structured sessions match on the session part, terminal panes stay exact', () => {
    const a = 'structured-agent-session-b9dd323f-6106-45ac-be5d-ff6c0ef2defa:c56f07fe-a596-40c9-ad44-422a30808168'
    const b = 'structured-agent-session-b9dd323f-6106-45ac-be5d-ff6c0ef2defa:f367c70d-9dfc-454d-acab-3937f15fc014'
    assert.equal(normalizePaneKey(a), normalizePaneKey(b))
    const index = new IdentityIndex()
    index.link('dispatch:ctx_1', { paneKey: b })
    assert.equal(index.resolve({ paneKey: a }), 'dispatch:ctx_1')
    // Terminal pane keys share their tab-group prefix, so they must not collapse.
    assert.notEqual(normalizePaneKey('group-1:pane-a'), normalizePaneKey('group-1:pane-b'))
    assert.equal(index.resolve({ paneKey: 'group-1:pane-b' }), null)
  })
})
