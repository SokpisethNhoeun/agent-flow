import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { emptyState } from '../src/shared/model.ts'
import { attentionItems, RECENT_FAILURE_MS } from '../src/ui/graph/attention.ts'
import { makeAgent, makeRun, makeTask } from './helpers/fixtures.ts'

const NOW = 1_800_000_000_000

describe('attentionItems', () => {
  it('lists blocked agents, open gates and recent failures, most urgent first', () => {
    const state = emptyState()
    state.runs.r1 = makeRun('r1', { state: 'active' })
    state.agents.a = makeAgent('a', { title: 'Blocked one', live: true, state: 'blocked', stateSince: NOW - 1000 })
    state.agents.b = makeAgent('b', { live: true, state: 'waiting' })
    state.agents.c = makeAgent('c', { title: 'Crashed', live: false, state: 'failed', endedAt: NOW - 60_000 })
    state.agents.old = makeAgent('old', { live: false, state: 'failed', endedAt: NOW - RECENT_FAILURE_MS - 1 })
    state.tasks.t1 = makeTask('t1', { runId: 'r1', title: 'Build', state: 'FAILED', completedAt: NOW - 5000, result: { outcome: 'failed', message: 'tests broke\nmore', filesModified: [], raw: null } })
    state.tasks.t2 = makeTask('t2', { runId: 'r1', title: 'Decide', state: 'BLOCKED' })
    state.gates.g1 = { id: 'g1', taskId: 't2', question: 'Ship it?', status: 'pending', resolution: null, createdAt: NOW - 2000 }
    state.gates.g2 = { id: 'g2', taskId: 't2', question: 'Old', status: 'resolved', resolution: 'yes', createdAt: NOW - 9000 }
    const items = attentionItems(state, NOW)
    assert.deepEqual(items.map((i) => [i.kind, i.selectId]), [['blocked', 'a'], ['gate', 't2'], ['failed-task', 't1'], ['failed-agent', 'c']])
    assert.equal(items[1].detail, 'Decision: Ship it?')
    assert.equal(items[2].detail, 'Failed: tests broke')
  })

  it('ignores failures of finished runs and live agents that are only waiting', () => {
    const state = emptyState()
    state.runs.r1 = makeRun('r1', { state: 'completed' })
    state.tasks.t1 = makeTask('t1', { runId: 'r1', state: 'FAILED', completedAt: NOW - 5000 })
    state.agents.b = makeAgent('b', { live: true, state: 'waiting' })
    assert.deepEqual(attentionItems(state, NOW), [])
  })
})
