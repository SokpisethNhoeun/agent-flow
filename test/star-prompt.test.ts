import assert from 'node:assert/strict'
import { test } from 'node:test'
import { applyAnswer, freshStarState, recordVisit, shouldAsk, StarPromptStore } from '../src/worker/state/star-prompt.ts'
import { tempDir } from './helpers/fixtures.ts'

const DAY = 24 * 60 * 60 * 1000
const T0 = new Date(2026, 10, 1, 10).getTime()

test('asks only after three days of use, at least three days in', () => {
  let s = freshStarState(T0)
  s = recordVisit(s, T0)
  s = recordVisit(s, T0 + 2 * 3600_000)
  assert.equal(s.days.length, 1, 'same day counts once')
  s = recordVisit(s, T0 + DAY)
  assert.equal(shouldAsk(s, T0 + DAY), false, 'two days used')
  s = recordVisit(s, T0 + 2 * DAY)
  assert.equal(shouldAsk(s, T0 + 2 * DAY), false, 'three days used but not three days old')
  s = recordVisit(s, T0 + 3 * DAY)
  assert.equal(shouldAsk(s, T0 + 3 * DAY), true)
})

test('later snoozes 30 days; starred and never stop it for good', () => {
  let s = freshStarState(T0)
  for (let d = 0; d < 4; d++) s = recordVisit(s, T0 + d * DAY)
  const later = applyAnswer(s, 'later', T0 + 3 * DAY)
  assert.equal(shouldAsk(later, T0 + 10 * DAY), false)
  assert.equal(shouldAsk(later, T0 + 34 * DAY), true)
  assert.equal(shouldAsk(applyAnswer(s, 'never', T0 + 3 * DAY), T0 + 400 * DAY), false)
  assert.equal(shouldAsk(applyAnswer(s, 'starred', T0 + 3 * DAY), T0 + 400 * DAY), false)
})

test('the store remembers across restarts and survives a broken file', async () => {
  const tmp = await tempDir()
  try {
    let now = T0
    const a = new StarPromptStore(tmp.dir, () => now)
    for (let d = 0; d < 4; d++) {
      now = T0 + d * DAY
      await a.visit()
    }
    assert.equal((await new StarPromptStore(tmp.dir, () => now).visit()).show, true)
    await new StarPromptStore(tmp.dir, () => now).answer('never')
    assert.equal((await new StarPromptStore(tmp.dir, () => now + 999 * DAY).visit()).show, false)
  } finally {
    await tmp.cleanup()
  }
})
