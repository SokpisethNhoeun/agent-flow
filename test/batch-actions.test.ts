import assert from 'node:assert/strict'
import { test } from 'node:test'
import { emptyState, type FlowState } from '../src/shared/model.ts'
import { batchActionsFor, batchConfirm } from '../src/ui/actions/batch-actions.ts'
import { makeAgent, makeTask } from './helpers/fixtures.ts'

function stateWithCaps(): FlowState {
  const state = emptyState()
  for (const kind of ['agent.stop', 'task.retry', 'task.cancel', 'terminal.focus'] as const) state.capabilities.commands[kind] = { available: true, mode: 'direct', reason: null }
  state.agents.w1 = makeAgent('w1', { role: 'worker', dispatchId: 'd1', live: true, taskId: 't1' })
  state.agents.w2 = makeAgent('w2', { role: 'worker', dispatchId: 'd2', live: false, taskId: 't2' })
  state.agents.a1 = makeAgent('a1', { role: 'agent', live: true })
  state.tasks.t1 = makeTask('t1', { runId: 'r1', state: 'RUNNING' })
  state.tasks.t2 = makeTask('t2', { runId: 'r1', state: 'FAILED' })
  state.tasks.t3 = makeTask('t3', { runId: 'r1', state: 'DONE' })
  return state
}

const byId = (list: ReturnType<typeof batchActionsFor>) => Object.fromEntries(list.map((a) => [a.id, a.commands]))

test('keeps only eligible targets and never retries one task twice', () => {
  const state = stateWithCaps()
  const result = byId(batchActionsFor([{ type: 'agent', id: 'w1' }, { type: 'agent', id: 'w2' }, { type: 'agent', id: 'a1' }, { type: 'task', id: 't2' }, { type: 'task', id: 't3' }], state, false))
  assert.deepEqual(result.stop, [{ kind: 'agent.stop', params: { agentId: 'w1' } }], 'only the live orchestration worker; plain agents cannot be stopped')
  assert.deepEqual(result.retry.map((c) => c.params.taskId), ['t2', 't3'], 't2 from its worker and its card counts once')
  assert.deepEqual(result.cancel.map((c) => c.params.taskId), ['t2'])
})

test('view-only dashboard offers nothing', () => {
  const result = batchActionsFor([{ type: 'agent', id: 'w1' }, { type: 'task', id: 't2' }], stateWithCaps(), true)
  assert.ok(result.every((a) => a.commands.length === 0))
  assert.ok(result.every((a) => a.reason?.startsWith('View-only')))
})

test('confirmation text names the count', () => {
  const [stop] = batchActionsFor([{ type: 'agent', id: 'w1' }], stateWithCaps(), false)
  assert.equal(batchConfirm(stop).title, 'Stop 1 worker?')
  assert.equal(batchConfirm(stop).danger, true)
})
