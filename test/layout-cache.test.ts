import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { ASYNC_MIN_NODES, layoutFor, onLayoutReady, provisional, resetLayoutCache, setAsyncLayouter } from '../src/ui/graph/layout-cache.ts'
import { computeLayout, type LayoutInput } from '../src/ui/graph/layout-engine.ts'

/** A lead with `n` workers. */
function fan(n: number): LayoutInput {
  const nodes = [{ id: 'lead', width: 300, height: 120 }, ...Array.from({ length: n }, (_, i) => ({ id: `w${i}`, width: 300, height: 150 }))]
  return { mode: 'hierarchy', nodes, edges: nodes.slice(1).map((w) => ({ id: `e-${w.id}`, source: 'lead', target: w.id })) }
}
const keyOf = (input: LayoutInput) => input.nodes.map((n) => n.id).join('|')

afterEach(() => {
  setAsyncLayouter(null)
  resetLayoutCache()
})

test('small graphs are laid out at once on the main thread, even with a worker', () => {
  let calls = 0
  setAsyncLayouter(async (input) => (calls++, computeLayout(input)))
  const input = fan(5)
  layoutFor('flat', keyOf(input), input)
  const grown = fan(6)
  const result = layoutFor('flat', keyOf(grown), grown)
  assert.equal(result.provisional, false)
  assert.equal(calls, 0)
})

test('a big graph that changes gets a provisional layout now and the real one from the worker', async () => {
  let release!: () => void
  const gate = new Promise<void>((r) => (release = r))
  setAsyncLayouter(async (input) => {
    await gate
    return computeLayout(input)
  })
  const first = fan(ASYNC_MIN_NODES)
  const initial = layoutFor('box:a', keyOf(first), first)
  assert.equal(initial.provisional, false, 'the first paint is exact (nothing to keep yet)')

  const grown = fan(ASYNC_MIN_NODES + 1)
  let ready = 0
  const stop = onLayoutReady(() => ready++)
  const quick = layoutFor('box:a', keyOf(grown), grown)
  assert.equal(quick.provisional, true)
  assert.deepEqual(quick.positions.w0, initial.positions.w0, 'known cards keep their place')
  const added = quick.positions[`w${ASYNC_MIN_NODES}`]
  assert.ok(added.x > initial.positions.lead.x, 'the new card sits right of its parent')

  release()
  await new Promise((r) => setTimeout(r, 10))
  assert.equal(ready, 1)
  const exact = layoutFor('box:a', keyOf(grown), grown)
  assert.equal(exact.provisional, false)
  assert.deepEqual(exact.positions, computeLayout(grown))
  stop()
})

test('a failing worker falls back to the main thread', async () => {
  setAsyncLayouter(async () => {
    throw new Error('no worker')
  })
  const first = fan(ASYNC_MIN_NODES)
  layoutFor('flat', keyOf(first), first)
  const grown = fan(ASYNC_MIN_NODES + 2)
  assert.equal(layoutFor('flat', keyOf(grown), grown).provisional, true)
  await new Promise((r) => setTimeout(r, 10))
  assert.deepEqual(layoutFor('flat', keyOf(grown), grown).positions, computeLayout(grown))
})

test('provisional: siblings stack under each other, orphans go below everything', () => {
  const input: LayoutInput = {
    mode: 'hierarchy',
    nodes: [{ id: 'p', width: 100, height: 50 }, { id: 'a', width: 100, height: 40 }, { id: 'b', width: 100, height: 40 }, { id: 'o', width: 100, height: 40 }],
    edges: [{ id: '1', source: 'p', target: 'a' }, { id: '2', source: 'p', target: 'b' }]
  }
  const out = provisional({ p: { x: 0, y: 0 } }, input)
  assert.equal(out.a.x, out.b.x)
  assert.ok(out.b.y >= out.a.y + 40, 'b is below a')
  assert.ok(out.o.y >= 50, 'orphan below the existing card')
})
