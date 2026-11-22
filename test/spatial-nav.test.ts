import assert from 'node:assert/strict'
import { test } from 'node:test'
import { firstBox, nextInDirection, type Box } from '../src/ui/graph/spatial-nav.ts'

const card = (id: string, x: number, y: number): Box => ({ id, x, y, width: 100, height: 50 })
// lead → two workers in a column to its right, a far-off card below-right
const lead = card('lead', 0, 100)
const w1 = card('w1', 300, 40)
const w2 = card('w2', 300, 160)
const far = card('far', 900, 600)
const all = [lead, w1, w2, far]

test('moves to the nearest card that is ahead, in line first', () => {
  assert.equal(nextInDirection(lead, all, 'right'), 'w1')
  assert.equal(nextInDirection(w1, all, 'down'), 'w2')
  assert.equal(nextInDirection(w2, all, 'up'), 'w1')
  assert.equal(nextInDirection(w1, all, 'left'), 'lead')
  assert.equal(nextInDirection(lead, all, 'left'), null, 'nothing that way')
  assert.equal(nextInDirection(w2, all, 'down'), 'far')
})

test('starts at the root (leftmost) card', () => {
  assert.equal(firstBox(all), 'lead')
  assert.equal(firstBox([]), null)
})
