import assert from 'node:assert/strict'
import { test } from 'node:test'
import { emptyState } from '../src/shared/model.ts'
import { announcements, summarize } from '../src/ui/graph/announcements.ts'
import { makeAgent, makeTask } from './helpers/fixtures.ts'

test('announces blocked (urgent), failed, finished and open decisions; ignores routine changes', () => {
  const prev = emptyState()
  prev.agents.a = makeAgent('a', { title: 'Worker A', live: true, state: 'working' })
  prev.agents.b = makeAgent('b', { title: 'Worker B', live: true, state: 'working' })
  prev.agents.c = makeAgent('c', { title: 'Worker C', live: true, state: 'working', tokens: 1 })
  prev.agents.s = makeAgent('s', { role: 'subagent', title: 'Sub', live: true, state: 'working' })
  prev.tasks.t = makeTask('t', { title: 'Build', state: 'RUNNING' })
  const next = structuredClone(prev)
  next.agents.a = { ...prev.agents.a, state: 'blocked' }
  next.agents.b = { ...prev.agents.b, state: 'done', live: false }
  next.agents.c = { ...prev.agents.c, tokens: 999 }
  next.agents.s = { ...prev.agents.s, state: 'failed' }
  next.tasks.t = { ...prev.tasks.t, state: 'FAILED' }
  next.gates.g = { id: 'g', taskId: 't', question: 'Ship it?', status: 'pending', resolution: null, createdAt: 1 }
  assert.deepEqual(announcements(prev, next), [
    { text: 'Worker A is blocked and needs you.', urgent: true },
    { text: 'Worker B finished.', urgent: false },
    { text: 'Task Build failed.', urgent: false },
    { text: 'Decision needed: Ship it?', urgent: true }
  ])
  assert.deepEqual(announcements(next, next), [], 'no change, nothing to say')
})

test('summarizes bursts', () => {
  const few = [{ text: 'A failed.', urgent: false }]
  assert.equal(summarize(few), 'A failed.')
  const many = [{ text: 'A failed.', urgent: false }, { text: 'B is blocked and needs you.', urgent: true }, { text: 'C finished.', urgent: false }, { text: 'D finished.', urgent: false }]
  assert.equal(summarize(many), '4 updates: 1 need you, 1 failed, 2 finished.')
})
