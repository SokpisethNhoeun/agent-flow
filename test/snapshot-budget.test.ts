import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { emptyState } from '../src/shared/model.ts'
import { fitSnapshot } from '../src/worker/transport/snapshot-budget.ts'
import { makeEvent, makeMessage, makeTask } from './helpers/fixtures.ts'

describe('fitSnapshot', () => {
  it('returns a small snapshot unchanged', () => {
    const snapshot = { state: emptyState(), events: [makeEvent('e1')] }
    assert.equal(fitSnapshot(snapshot), snapshot)
  })

  it('trims events, message bodies and task text until it fits the budget', () => {
    const state = emptyState()
    for (let i = 0; i < 200; i++) state.tasks[`t${i}`] = makeTask(`t${i}`, { spec: 'x'.repeat(5000) })
    state.messages = Array.from({ length: 200 }, (_, i) => makeMessage(`m${i}`, { body: 'y'.repeat(3000) }))
    const events = Array.from({ length: 1000 }, (_, i) => makeEvent(`e${i}`, { summary: 'z'.repeat(200) }))
    const budget = 300 * 1024
    const fitted = fitSnapshot({ state, events }, budget)
    assert.ok(Buffer.byteLength(JSON.stringify(fitted)) <= budget)
    assert.equal(Object.keys(fitted.state.tasks).length, 200, 'tasks are kept, only their text shrinks')
    assert.ok(fitted.events.length < 1000)
  })
})
