import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ViewerTracker } from '../src/worker/state/viewers.ts'

test('starts idle, becomes watched on touch, idles again after the window', () => {
  let now = 1_000_000
  const viewers = new ViewerTracker(() => now, 1000)
  assert.equal(viewers.idle, true)
  assert.equal(viewers.pace(5, 50), 50)
  assert.equal(viewers.touch(), true, 'first touch ends an idle stretch')
  assert.equal(viewers.idle, false)
  assert.equal(viewers.pace(5, 50), 5)
  now += 500
  assert.equal(viewers.touch(), false, 'still watched')
  now += 1001
  assert.equal(viewers.idle, true)
})
