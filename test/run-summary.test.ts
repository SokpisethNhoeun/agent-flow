import assert from 'node:assert/strict'
import { test } from 'node:test'
import { emptyState } from '../src/shared/model.ts'
import { formatElapsed, summarizeRun } from '../src/ui/graph/run-summary.ts'
import { makeAgent, makeRun, makeTask } from './helpers/fixtures.ts'

test('sums progress, known tokens and accounts for one run', () => {
  const state = emptyState()
  state.runs.r1 = makeRun('r1', { state: 'active', startedAt: 1000, endedAt: null })
  state.runs.r2 = makeRun('r2')
  state.tasks.a = makeTask('a', { runId: 'r1', state: 'DONE' })
  state.tasks.b = makeTask('b', { runId: 'r1', state: 'FAILED' })
  state.tasks.c = makeTask('c', { runId: 'r1', state: 'RUNNING' })
  state.tasks.d = makeTask('d', { runId: 'r2', state: 'DONE' })
  state.agents.x = makeAgent('x', { runId: 'r1', tokens: 1500, account: { accountId: '1', label: 'Work', provider: 'claude', source: 'config' } })
  state.agents.y = makeAgent('y', { runId: 'r1', tokens: null })
  const s = summarizeRun(state, 'r1', 61_000)!
  assert.deepEqual({ ...s }, { elapsedMs: 60_000, total: 3, done: 1, failed: 1, running: 1, agents: 2, tokens: 1500, tokensPartial: true, accounts: ['Work'] })
})

test('no token counts at all stays unknown, not zero', () => {
  const state = emptyState()
  state.runs.r1 = makeRun('r1', { state: 'completed', startedAt: null })
  state.agents.y = makeAgent('y', { runId: 'r1', tokens: null })
  const s = summarizeRun(state, 'r1', 0)!
  assert.equal(s.tokens, null)
  assert.equal(s.tokensPartial, false)
  assert.equal(s.elapsedMs, null)
  assert.equal(summarizeRun(state, 'missing', 0), null)
})

test('formats elapsed time', () => {
  assert.equal(formatElapsed(null), null)
  assert.equal(formatElapsed(4000), '4s')
  assert.equal(formatElapsed(5 * 60000), '5m')
  assert.equal(formatElapsed(125 * 60000), '2h 5m')
})
