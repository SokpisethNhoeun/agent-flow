import assert from 'node:assert/strict'
import { test } from 'node:test'
import { compareRuns, runTotals } from '../src/ui/graph/compare-runs.ts'
import { makeAgent, makeRun, makeTask } from './helpers/fixtures.ts'

const min = 60_000

test('matches tasks by name and classifies each change', () => {
  const a = {
    run: makeRun('a', { startedAt: 0, endedAt: 30 * min }),
    agents: [makeAgent('x', { tokens: 1000 }), makeAgent('y', { tokens: null })],
    tasks: [
      makeTask('1', { title: 'Write tests', state: 'FAILED' }),
      makeTask('2', { title: 'Build  API', state: 'DONE', createdAt: 0, completedAt: 10 * min }),
      makeTask('3', { title: 'Docs', state: 'DONE' }),
      makeTask('4', { title: 'Lint', state: 'DONE', createdAt: 0, completedAt: 2 * min }),
      makeTask('5', { title: 'Old step', state: 'DONE' })
    ]
  }
  const b = {
    run: makeRun('b'),
    agents: [],
    tasks: [
      makeTask('1b', { title: 'write tests', state: 'DONE' }),
      makeTask('2b', { title: 'Build API', state: 'DONE', createdAt: 0, completedAt: 25 * min }),
      makeTask('3b', { title: 'Docs', state: 'FAILED' }),
      makeTask('4b', { title: 'Lint', state: 'DONE', createdAt: 0, completedAt: 2 * min + 10_000 }),
      makeTask('6b', { title: 'New step', state: 'RUNNING' })
    ]
  }
  const rows = Object.fromEntries(compareRuns(a, b).map((r) => [r.name.toLowerCase(), r.change]))
  assert.deepEqual(rows, { docs: 'broke', 'write tests': 'fixed', 'build api': 'slower', 'new step': 'added', 'old step': 'removed', lint: 'same' })
  assert.equal(compareRuns(a, b)[0].change, 'broke', 'regressions first')
  assert.deepEqual(runTotals(a), { tasks: 5, done: 4, failed: 1, durationMs: 30 * min, ongoing: false, tokens: 1000 })
  const active = { ...b, run: makeRun('b', { state: 'active', startedAt: 0, endedAt: null }), savedAt: 7 * min }
  assert.equal(runTotals(active).durationMs, 7 * min, 'an active run counts up to when it was saved')
  assert.equal(runTotals(active).ongoing, true)
  assert.equal(runTotals(b).tokens, null, 'no counts reported stays unknown')
})
