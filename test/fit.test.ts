import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { planViewport, READABLE_ZOOM } from '../src/ui/graph/fit.ts'

describe('planViewport', () => {
  it('fits and centers everything when that stays readable', () => {
    const vp = planViewport({ x: 0, y: 0, width: 500, height: 300 }, null, { width: 1048, height: 648 })
    assert.equal(vp.zoom, 1.1)
    assert.equal(vp.x, 24 + (1000 - 550) / 2)
  })

  it('zooms to the busy cards at a readable size when everything would be tiny', () => {
    const whole = { x: 0, y: 0, width: 1200, height: 2400 }
    const focus = { x: 100, y: 200, width: 900, height: 2000 }
    const vp = planViewport(whole, focus, { width: 600, height: 800 })
    assert.equal(vp.zoom, READABLE_ZOOM)
    // Too wide and too tall for the panel: start at the top-left of the busy cards.
    assert.equal(vp.x, 24 - 100 * READABLE_ZOOM)
    assert.equal(vp.y, 24 - 200 * READABLE_ZOOM)
  })

  it('without busy cards keeps the whole-graph fit even if small', () => {
    const vp = planViewport({ x: 0, y: 0, width: 4000, height: 4000 }, null, { width: 448, height: 448 })
    assert.equal(vp.zoom, 0.1)
  })
})
