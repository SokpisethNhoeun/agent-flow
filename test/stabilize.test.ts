import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { deepEqual, emptyCache, stabilize } from '../src/ui/graph/stabilize.ts'

describe('stabilize', () => {
  it('compares nested values structurally', () => {
    assert.equal(deepEqual({ a: [1, { b: 'x' }] }, { a: [1, { b: 'x' }] }), true)
    assert.equal(deepEqual({ a: [1, { b: 'x' }] }, { a: [1, { b: 'y' }] }), false)
    assert.equal(deepEqual({ a: 1 }, { a: 1, b: undefined }), false)
    assert.equal(deepEqual([1], { 0: 1 }), false)
    assert.equal(deepEqual(null, {}), false)
  })

  it('keeps unchanged items and the whole array when nothing changed', () => {
    const cache = emptyCache<{ id: string; data: { n: number } }>()
    const first = stabilize(cache, [{ id: 'a', data: { n: 1 } }, { id: 'b', data: { n: 2 } }])
    const second = stabilize(cache, [{ id: 'a', data: { n: 1 } }, { id: 'b', data: { n: 2 } }])
    assert.equal(second, first)
    const third = stabilize(cache, [{ id: 'a', data: { n: 1 } }, { id: 'b', data: { n: 3 } }])
    assert.notEqual(third, first)
    assert.equal(third[0], first[0])
    assert.notEqual(third[1], first[1])
  })

  it('notices removed, added and reordered items', () => {
    const cache = emptyCache<{ id: string }>()
    const first = stabilize(cache, [{ id: 'a' }, { id: 'b' }])
    const reordered = stabilize(cache, [{ id: 'b' }, { id: 'a' }])
    assert.notEqual(reordered, first)
    assert.equal(reordered[0], first[1])
    const shorter = stabilize(cache, [{ id: 'b' }])
    assert.equal(shorter.length, 1)
  })
})
