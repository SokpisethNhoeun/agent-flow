import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import type { TaskKind, TaskState } from '../src/shared/model.ts'
import { canTransition, inferTaskKind, mapOrcaTaskStatus, TASK_TRANSITIONS, TERMINAL_TASK_STATES } from '../src/shared/task-states.ts'

const base = { orcaStatus: 'pending', kind: 'task' as TaskKind, resultOutcome: null as string | null, hasOpenGate: false, retryCount: 0, dispatchActive: false }
const map = (overrides: Partial<typeof base>) => mapOrcaTaskStatus({ ...base, ...overrides })

describe('canTransition', () => {
  it('allows a state to stay the same', () => {
    for (const state of Object.keys(TASK_TRANSITIONS) as TaskState[]) assert.equal(canTransition(state, state), true)
  })

  it('follows the transition table', () => {
    assert.equal(canTransition('PENDING', 'READY'), true)
    assert.equal(canTransition('READY', 'RUNNING'), true)
    assert.equal(canTransition('RUNNING', 'REVIEW'), true)
    assert.equal(canTransition('REVIEW', 'TESTING'), true)
    assert.equal(canTransition('TESTING', 'APPROVED'), true)
    assert.equal(canTransition('APPROVED', 'MERGED'), true)
    assert.equal(canTransition('MERGED', 'DONE'), true)
    assert.equal(canTransition('FAILED', 'RETRYING'), true)
    assert.equal(canTransition('RETRYING', 'RUNNING'), true)
    assert.equal(canTransition('CANCELLED', 'RETRYING'), true)
  })

  it('rejects transitions outside the table', () => {
    assert.equal(canTransition('PENDING', 'DONE'), false)
    assert.equal(canTransition('DONE', 'RUNNING'), false)
    assert.equal(canTransition('MERGED', 'RUNNING'), false)
    assert.equal(canTransition('FAILED', 'DONE'), false)
    assert.equal(canTransition('CANCELLED', 'RUNNING'), false)
    assert.equal(canTransition('APPROVED', 'REVIEW'), false)
  })

  it('every terminal state can only move to RETRYING (or DONE from MERGED)', () => {
    for (const state of TERMINAL_TASK_STATES) {
      for (const to of TASK_TRANSITIONS[state]) assert.ok(to === 'RETRYING' || to === 'DONE' || to === 'CANCELLED', `${state} → ${to}`)
    }
  })
})

describe('mapOrcaTaskStatus', () => {
  it('pending → PENDING', () => assert.equal(map({ orcaStatus: 'pending' }), 'PENDING'))
  it('is case-insensitive', () => assert.equal(map({ orcaStatus: 'PENDING' }), 'PENDING'))
  it('unknown status → PENDING', () => assert.equal(map({ orcaStatus: 'weird' }), 'PENDING'))

  it('ready → READY, or RETRYING after a retry', () => {
    assert.equal(map({ orcaStatus: 'ready' }), 'READY')
    assert.equal(map({ orcaStatus: 'ready', retryCount: 1 }), 'RETRYING')
  })

  it('dispatched depends on kind and retry', () => {
    assert.equal(map({ orcaStatus: 'dispatched' }), 'RUNNING')
    assert.equal(map({ orcaStatus: 'dispatched', kind: 'review' }), 'REVIEW')
    assert.equal(map({ orcaStatus: 'dispatched', kind: 'test' }), 'TESTING')
    assert.equal(map({ orcaStatus: 'dispatched', kind: 'merge' }), 'RUNNING')
    assert.equal(map({ orcaStatus: 'dispatched', retryCount: 2, dispatchActive: false }), 'RETRYING')
    assert.equal(map({ orcaStatus: 'dispatched', retryCount: 2, dispatchActive: true }), 'RUNNING')
  })

  it('completed maps by outcome and kind', () => {
    assert.equal(map({ orcaStatus: 'completed' }), 'DONE')
    assert.equal(map({ orcaStatus: 'completed', resultOutcome: 'succeeded' }), 'DONE')
    assert.equal(map({ orcaStatus: 'completed', kind: 'merge' }), 'MERGED')
    assert.equal(map({ orcaStatus: 'completed', kind: 'review' }), 'DONE')
    assert.equal(map({ orcaStatus: 'completed', resultOutcome: 'failed' }), 'FAILED')
    assert.equal(map({ orcaStatus: 'completed', resultOutcome: 'Failure' }), 'FAILED')
    assert.equal(map({ orcaStatus: 'completed', resultOutcome: 'cancelled' }), 'CANCELLED')
    assert.equal(map({ orcaStatus: 'completed', resultOutcome: 'cancellation' }), 'CANCELLED')
  })

  it('failed → FAILED unless the outcome mentions cancel', () => {
    assert.equal(map({ orcaStatus: 'failed' }), 'FAILED')
    assert.equal(map({ orcaStatus: 'failed', resultOutcome: 'cancelled' }), 'CANCELLED')
    assert.equal(map({ orcaStatus: 'failed', resultOutcome: 'user_cancel' }), 'CANCELLED')
  })

  it('blocked → BLOCKED', () => assert.equal(map({ orcaStatus: 'blocked' }), 'BLOCKED'))

  it('an open gate blocks non-terminal tasks only', () => {
    assert.equal(map({ orcaStatus: 'pending', hasOpenGate: true }), 'BLOCKED')
    assert.equal(map({ orcaStatus: 'ready', hasOpenGate: true }), 'BLOCKED')
    assert.equal(map({ orcaStatus: 'dispatched', hasOpenGate: true }), 'BLOCKED')
    assert.equal(map({ orcaStatus: 'completed', hasOpenGate: true }), 'DONE')
    assert.equal(map({ orcaStatus: 'failed', hasOpenGate: true }), 'FAILED')
  })
})

describe('inferTaskKind', () => {
  const cases: [string, TaskKind][] = [
    ['Merge feature branches', 'merge'],
    ['Integration of services', 'merge'],
    ['Deliver release', 'merge'],
    ['Write unit tests', 'test'],
    ['QA the checkout', 'test'],
    ['Verify login', 'test'],
    ['e2e smoke', 'test'],
    ['Review API', 'review'],
    ['Security audit', 'review'],
    ['Plan the migration', 'plan'],
    ['Architecture proposal', 'plan'],
    ['Analyse logs', 'plan'],
    ['Analyze logs', 'plan'],
    ['Implement login form', 'task'],
    ['Contest entry', 'task'],
    ['', 'task']
  ]
  for (const [title, kind] of cases) it(`"${title}" → ${kind}`, () => assert.equal(inferTaskKind(title), kind))

  it('merge wins over test and review', () => assert.equal(inferTaskKind('Review and merge after tests'), 'merge'))
  it('test wins over review', () => assert.equal(inferTaskKind('Review the failing tests'), 'test'))
  it('a bare "test" label is not a testing task', () => assert.equal(inferTaskKind('AF test: implement greeting'), 'task'))
  it('"run tests" is a testing task', () => assert.equal(inferTaskKind('AF test: run tests'), 'test'))
})
