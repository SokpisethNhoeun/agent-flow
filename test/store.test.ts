import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { applyPatch, MAX_MESSAGES, MAX_TOOL_CALLS, type FlowDelta } from '../src/shared/events.ts'
import { emptyState } from '../src/shared/model.ts'
import { newAgent } from '../src/worker/context.ts'
import { FlowStore } from '../src/worker/state/store.ts'
import { makeAgent, makeEvent, makeMessage, makeTask } from './helpers/fixtures.ts'

function collect(store: FlowStore): FlowDelta[] {
  const deltas: FlowDelta[] = []
  store.subscribe((delta) => deltas.push(delta))
  return deltas
}

const create = (id: string) => () => newAgent(id, 'agent', 0)

describe('FlowStore: seq and deltas', () => {
  it('bumps seq for every patch and event', () => {
    const store = new FlowStore(0)
    assert.equal(store.seq, 0)
    store.upsertAgent('a', 1, { title: 'A' }, create('a'))
    assert.equal(store.seq, 1)
    const event = store.emit({ ts: 1, kind: 'agent.created', source: 'host-call', entityId: 'a', summary: 'x' })
    assert.equal(event?.seq, 2)
    assert.equal(store.seq, 2)
    store.dispose()
  })

  it('batches patches and events into one delta until flushed', () => {
    const store = new FlowStore(10_000)
    const deltas = collect(store)
    store.upsertAgent('a', 1, { title: 'A' }, create('a'))
    store.upsertAgent('a', 2, { title: 'A2' }, create('a'))
    store.upsertTask(makeTask('t1'))
    store.emit({ ts: 1, kind: 'task.created', source: 'cli-poll', entityId: 't1', summary: '' })
    assert.equal(deltas.length, 0)
    store.flushNow()
    assert.equal(deltas.length, 1)
    const [delta] = deltas
    assert.equal(delta.fromSeq, 0)
    assert.equal(delta.toSeq, 4)
    assert.equal(delta.patches.length, 2, 'same entity collapses to its latest patch')
    const agentPatch = delta.patches.find((p) => p.entity === 'agent')
    assert.equal(agentPatch?.entity === 'agent' && agentPatch.value?.title, 'A2')
    assert.equal(delta.events.length, 1)
    store.flushNow()
    assert.equal(deltas.length, 1, 'nothing pending → no empty delta')
    store.dispose()
  })

  it('keeps fromSeq/toSeq continuous across flushes', () => {
    const store = new FlowStore(10_000)
    const deltas = collect(store)
    store.upsertAgent('a', 1, { title: 'A' }, create('a'))
    store.flushNow()
    store.upsertAgent('b', 1, { title: 'B' }, create('b'))
    store.emit({ ts: 1, kind: 'agent.created', source: 'host-call', entityId: 'b', summary: '' })
    store.flushNow()
    store.upsertTask(makeTask('t'))
    store.flushNow()
    assert.equal(deltas.length, 3)
    assert.equal(deltas[0].fromSeq, 0)
    for (let i = 1; i < deltas.length; i++) assert.equal(deltas[i].fromSeq, deltas[i - 1].toSeq)
    assert.equal(deltas.at(-1)?.toSeq, store.seq)
    store.dispose()
  })

  it('flushes on its own timer (flushMs 0)', async () => {
    const store = new FlowStore(0)
    const deltas = collect(store)
    store.upsertAgent('a', 1, { title: 'A' }, create('a'))
    await new Promise((resolve) => setTimeout(resolve, 5))
    assert.equal(deltas.length, 1)
    assert.deepEqual([deltas[0].fromSeq, deltas[0].toSeq], [0, 1])
    store.upsertAgent('a', 2, { title: 'B' }, create('a'))
    await new Promise((resolve) => setTimeout(resolve, 5))
    assert.deepEqual([deltas[1].fromSeq, deltas[1].toSeq], [1, 2])
    store.dispose()
  })

  it('a throwing listener does not stop the others', () => {
    const store = new FlowStore(10_000)
    store.subscribe(() => {
      throw new Error('broken')
    })
    const deltas = collect(store)
    store.upsertTask(makeTask('t'))
    store.flushNow()
    assert.equal(deltas.length, 1)
    store.dispose()
  })

  it('snapshot flushes and returns a deep copy', () => {
    const store = new FlowStore(10_000)
    const deltas = collect(store)
    store.upsertTask(makeTask('t'))
    const snap = store.snapshot()
    assert.equal(deltas.length, 1)
    snap.state.tasks.t.title = 'mutated'
    assert.equal(store.read().tasks.t.title, 'Task t')
    store.dispose()
  })
})

describe('FlowStore: events', () => {
  it('drops events with an id it has already seen', () => {
    const store = new FlowStore(10_000)
    const first = store.emit({ id: 'e1', ts: 1, kind: 'task.created', source: 'cli-poll', entityId: 't', summary: '' })
    const second = store.emit({ id: 'e1', ts: 2, kind: 'task.created', source: 'cli-poll', entityId: 't', summary: '' })
    assert.ok(first)
    assert.equal(second, null)
    assert.equal(store.events().length, 1)
    assert.equal(store.seq, 1)
    assert.equal(store.hasEvent('task.created', 't'), true)
    assert.equal(store.hasEvent('task.failed', 't'), false)
    store.dispose()
  })

  it('generates unique ids when none is given', () => {
    const store = new FlowStore(10_000)
    store.emit({ ts: 1, kind: 'tool.called', source: 'hook', entityId: 'a', summary: '' })
    store.emit({ ts: 1, kind: 'tool.called', source: 'hook', entityId: 'a', summary: '' })
    assert.equal(store.events().length, 2)
    assert.notEqual(store.events()[0].id, store.events()[1].id)
    store.dispose()
  })
})

describe('FlowStore: upsertAgent ordering', () => {
  it('ignores a stale state observation but applies its other fields', () => {
    const store = new FlowStore(10_000)
    store.upsertAgent('a', 200, { state: 'working', live: true }, create('a'))
    const after = store.upsertAgent('a', 100, { state: 'done', live: false, outcome: 'success', endedAt: 100, title: 'Renamed', model: 'm1' }, create('a'))
    assert.equal(after.state, 'working')
    assert.equal(after.live, true)
    assert.equal(after.outcome, null)
    assert.equal(after.endedAt, null)
    assert.equal(after.title, 'Renamed')
    assert.equal(after.model, 'm1')
    assert.equal(after.lastSeenAt, 200, 'lastSeenAt never goes backwards')
    store.dispose()
  })

  it('accepts a newer or equally new state observation', () => {
    const store = new FlowStore(10_000)
    store.upsertAgent('a', 100, { state: 'working', live: true }, create('a'))
    assert.equal(store.upsertAgent('a', 100, { state: 'blocked' }, create('a')).state, 'blocked')
    assert.equal(store.upsertAgent('a', 300, { state: 'done', live: false }, create('a')).state, 'done')
    store.dispose()
  })

  it('a non-state update with an old timestamp does not move the state clock', () => {
    const store = new FlowStore(10_000)
    store.upsertAgent('a', 100, { state: 'working' }, create('a'))
    store.upsertAgent('a', 500, { title: 'x' }, create('a'))
    assert.equal(store.upsertAgent('a', 200, { state: 'done' }, create('a')).state, 'done')
    store.dispose()
  })

  it('merges evidence without duplicates and skips undefined values', () => {
    const store = new FlowStore(10_000)
    store.upsertAgent('a', 1, { title: 'A', evidence: ['hook'] }, create('a'))
    const next = store.upsertAgent('a', 2, { title: undefined, evidence: ['hook', 'cli-poll'] }, create('a'))
    assert.equal(next.title, 'A')
    assert.deepEqual(next.evidence, ['hook', 'cli-poll'])
    store.dispose()
  })

  it('returns the existing record and emits nothing when unchanged', () => {
    const store = new FlowStore(10_000)
    const first = store.upsertAgent('a', 1, { title: 'A' }, create('a'))
    const seq = store.seq
    const second = store.upsertAgent('a', 5, { title: 'A' }, create('a'))
    assert.equal(second, first)
    assert.equal(store.seq, seq)
    assert.equal(first.version, 1)
    store.dispose()
  })

  it('removeAgent forgets the state clock', () => {
    const store = new FlowStore(10_000)
    store.upsertAgent('a', 500, { state: 'working' }, create('a'))
    store.removeAgent('a')
    assert.equal(store.read().agents.a, undefined)
    assert.equal(store.upsertAgent('a', 1, { state: 'done' }, create('a')).state, 'done')
    const seq = store.seq
    store.removeAgent('missing')
    assert.equal(store.seq, seq)
    store.dispose()
  })
})

describe('FlowStore: upsertTask and put', () => {
  it('upsertTask bumps version only on change', () => {
    const store = new FlowStore(10_000)
    assert.equal(store.upsertTask(makeTask('t')).version, 1)
    const seq = store.seq
    assert.equal(store.upsertTask(makeTask('t', { version: 99 })).version, 1)
    assert.equal(store.seq, seq)
    assert.equal(store.upsertTask(makeTask('t', { state: 'RUNNING' })).version, 2)
    store.dispose()
  })

  it('put is a no-op when the value is unchanged or already absent', () => {
    const store = new FlowStore(10_000)
    const gate = { id: 'g1', taskId: 't', question: 'Ship?', status: 'pending', resolution: null, createdAt: 1 }
    store.put({ entity: 'gate', id: 'g1', value: gate })
    const seq = store.seq
    store.put({ entity: 'gate', id: 'g1', value: { ...gate } })
    assert.equal(store.seq, seq)
    store.put({ entity: 'gate', id: 'missing', value: null })
    assert.equal(store.seq, seq)
    store.put({ entity: 'gate', id: 'g1', value: { ...gate, status: 'resolved' } })
    assert.equal(store.seq, seq + 1)
    store.put({ entity: 'gate', id: 'g1', value: null })
    assert.equal(store.read().gates.g1, undefined)
    store.dispose()
  })

  it('put updates messages in place by id', () => {
    const store = new FlowStore(10_000)
    store.put({ entity: 'message', id: 'm1', value: makeMessage('m1', { subject: 'a' }) })
    store.put({ entity: 'message', id: 'm1', value: makeMessage('m1', { subject: 'b' }) })
    assert.equal(store.read().messages.length, 1)
    assert.equal(store.read().messages[0].subject, 'b')
    store.dispose()
  })
})

describe('FlowStore: restore', () => {
  it('marks agents not live, resets working/blocked/waiting to unknown and emits a reset delta', () => {
    const store = new FlowStore(10_000)
    store.upsertTask(makeTask('existing'))
    const deltas = collect(store)
    const state = emptyState()
    state.seq = 40
    state.agents = {
      w: makeAgent('w', { state: 'working', live: true }),
      b: makeAgent('b', { state: 'blocked', live: true }),
      q: makeAgent('q', { state: 'waiting', live: true }),
      d: makeAgent('d', { state: 'done', live: false }),
      f: makeAgent('f', { state: 'failed', live: true })
    }
    store.restore({ state, events: [makeEvent('old-1')] })
    const agents = store.read().agents
    for (const id of ['w', 'b', 'q']) assert.equal(agents[id].state, 'unknown', id)
    assert.equal(agents.d.state, 'done')
    assert.equal(agents.f.state, 'failed')
    for (const agent of Object.values(agents)) assert.equal(agent.live, false)
    assert.equal(store.seq, 41)
    assert.equal(deltas.length, 1)
    assert.deepEqual(deltas[0], { fromSeq: -1, toSeq: 41, patches: [], events: [] })
    assert.equal(store.emit({ id: 'old-1', ts: 0, kind: 'agent.created', source: 'cli-poll', entityId: 'x', summary: '' }), null, 'restored event ids are deduped')
    store.dispose()
  })

  it('seq never goes backwards on restore', () => {
    const store = new FlowStore(10_000)
    for (let i = 0; i < 5; i++) store.upsertTask(makeTask(`t${i}`))
    const state = emptyState()
    state.seq = 2
    store.restore({ state, events: [] })
    assert.equal(store.seq, 6)
    store.dispose()
  })

  it('deltas after a restore continue from the restored seq', () => {
    const store = new FlowStore(10_000)
    const deltas = collect(store)
    const state = emptyState()
    state.seq = 10
    store.restore({ state, events: [] })
    store.upsertTask(makeTask('t'))
    store.flushNow()
    assert.equal(deltas[1].fromSeq, 11)
    assert.equal(deltas[1].toSeq, 12)
    store.dispose()
  })
})

describe('applyPatch caps', () => {
  it('keeps at most MAX_MESSAGES messages, dropping the oldest', () => {
    const state = emptyState()
    for (let i = 0; i < MAX_MESSAGES + 5; i++) applyPatch(state, { entity: 'message', id: `m${i}`, value: makeMessage(`m${i}`) })
    assert.equal(state.messages.length, MAX_MESSAGES)
    assert.equal(state.messages[0].id, 'm5')
    assert.equal(state.messages.at(-1)?.id, `m${MAX_MESSAGES + 4}`)
  })

  it('keeps at most MAX_TOOL_CALLS tool calls and replaces by id', () => {
    const state = emptyState()
    const call = (id: string, phase: 'started' | 'finished') => ({ id, agentId: null, terminalId: null, tool: 'Bash', summary: '', at: 0, phase })
    for (let i = 0; i < MAX_TOOL_CALLS + 3; i++) applyPatch(state, { entity: 'toolCall', id: `c${i}`, value: call(`c${i}`, 'started') })
    assert.equal(state.toolCalls.length, MAX_TOOL_CALLS)
    assert.equal(state.toolCalls[0].id, 'c3')
    applyPatch(state, { entity: 'toolCall', id: 'c10', value: call('c10', 'finished') })
    assert.equal(state.toolCalls.length, MAX_TOOL_CALLS)
    assert.equal(state.toolCalls.find((c) => c.id === 'c10')?.phase, 'finished')
  })

  it('null deletes keyed entities', () => {
    const state = emptyState()
    applyPatch(state, { entity: 'task', id: 't', value: makeTask('t') })
    applyPatch(state, { entity: 'task', id: 't', value: null })
    assert.deepEqual(state.tasks, {})
  })
})
