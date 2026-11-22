import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { emptyState } from '../src/shared/model.ts'
import { visibleAgents, visibleTasks } from '../src/ui/graph/visibility.ts'
import { defaultView } from '../src/ui/state/view-store.ts'
import { makeAgent, makeTask } from './helpers/fixtures.ts'

describe('active-only view', () => {
  const state = emptyState()
  state.agents['lead:r1'] = makeAgent('lead:r1', { role: 'lead', runId: 'r1' })
  state.agents['dispatch:a'] = makeAgent('dispatch:a', { role: 'worker', runId: 'r1', parentId: 'lead:r1', live: true, state: 'working' })
  state.agents['sub:1'] = makeAgent('sub:1', { role: 'subagent', parentId: 'dispatch:a', live: true, state: 'working' })
  state.agents['dispatch:b'] = makeAgent('dispatch:b', { role: 'worker', runId: 'r1', parentId: 'lead:r1', live: false, state: 'done' })
  state.agents['term:c'] = makeAgent('term:c', { role: 'agent', live: true, state: 'waiting' })
  state.agents['term:d'] = makeAgent('term:d', { role: 'agent', live: false, state: 'working' })
  state.tasks.t1 = makeTask('t1', { runId: 'r1', state: 'RUNNING' })
  state.tasks.t2 = makeTask('t2', { runId: 'r1', state: 'DONE' })

  it('shows live working/waiting/blocked agents and the chain that connects them', () => {
    const ids = visibleAgents(state, defaultView(false).filters, Date.now()).map((a) => a.id).sort()
    assert.deepEqual(ids, ['dispatch:a', 'lead:r1', 'sub:1', 'term:c'])
  })

  it('never shows an agent as active without live evidence', () => {
    const ids = visibleAgents(state, defaultView(false).filters, Date.now()).map((a) => a.id)
    assert.ok(!ids.includes('term:d'))
  })

  it('"All" shows finished work again', () => {
    const filters = { ...defaultView(false).filters, activeOnly: false }
    assert.ok(visibleAgents(state, filters, Date.now()).some((a) => a.id === 'dispatch:b'))
    assert.deepEqual(visibleTasks(state, filters).map((t) => t.id).sort(), ['t1', 't2'])
  })

  it('workflow keeps only tasks in progress', () => {
    assert.deepEqual(visibleTasks(state, defaultView(false).filters).map((t) => t.id), ['t1'])
  })
})
