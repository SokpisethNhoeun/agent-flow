import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readdir, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { emptyState } from '../src/shared/model.ts'
import { Persistence, safeName, type RunHistoryRecord } from '../src/worker/state/persistence.ts'
import { makeEvent, makeRun, makeTask, tempDir } from './helpers/fixtures.ts'

function record(id: string, startedAt: number | null, savedAt = 1): RunHistoryRecord {
  return { version: 1, savedAt, run: makeRun(id, { startedAt, state: 'completed', taskCount: 1 }), tasks: [makeTask('t', { runId: id })], agents: [], messages: [], events: [] }
}

describe('Persistence', () => {
  let dir = ''
  let cleanup: () => Promise<void> = async () => {}
  let persistence: Persistence
  before(async () => {
    ;({ dir, cleanup } = await tempDir())
    persistence = new Persistence(dir)
    await persistence.init()
  })
  after(() => cleanup())

  it('returns null when there is no snapshot yet', async () => {
    assert.equal(await new Persistence(join(dir, 'nowhere')).loadSnapshot(), null)
  })

  it('round-trips a snapshot', async () => {
    const state = emptyState()
    state.seq = 7
    state.tasks.t1 = makeTask('t1')
    await persistence.saveSnapshot({ state, events: [makeEvent('e1')] })
    const loaded = await persistence.loadSnapshot()
    assert.equal(loaded?.state.seq, 7)
    assert.equal(loaded?.state.tasks.t1.title, 'Task t1')
    assert.equal(loaded?.events[0].id, 'e1')
    const mode = (await stat(join(dir, 'snapshot.json'))).mode & 0o777
    assert.equal(mode, 0o600)
    assert.ok(!(await readdir(dir)).some((name) => name.endsWith('.tmp')), 'no temp file left behind')
  })

  it('rejects a snapshot without a numeric seq or with broken JSON', async () => {
    await writeFile(join(dir, 'snapshot.json'), JSON.stringify({ state: { seq: 'x' }, events: [] }))
    assert.equal(await persistence.loadSnapshot(), null)
    await writeFile(join(dir, 'snapshot.json'), '{broken')
    assert.equal(await persistence.loadSnapshot(), null)
  })

  it('saves, lists (newest first) and loads runs', async () => {
    await persistence.saveRun(record('run_old', 1000))
    await persistence.saveRun(record('run_new', 5000))
    await persistence.saveRun(record('run_unstarted', null, 3000))
    await writeFile(join(dir, 'history', 'junk.json'), 'not json')
    const runs = await persistence.listRuns()
    assert.deepEqual(runs.map((r) => r.id), ['run_new', 'run_unstarted', 'run_old'])
    assert.deepEqual(Object.keys(runs[0]).sort(), ['endedAt', 'id', 'objective', 'savedAt', 'startedAt', 'state', 'taskCount'])
    const loaded = await persistence.loadRun('run_new')
    assert.equal(loaded?.run.id, 'run_new')
    assert.equal(loaded?.tasks[0].runId, 'run_new')
    assert.equal(await persistence.loadRun('missing'), null)
  })

  it('stores ids with unsafe characters under a safe file name', async () => {
    await persistence.saveRun(record('../../etc/passwd', 1))
    const names = await readdir(join(dir, 'history'))
    assert.ok(names.includes('.._.._etc_passwd.json'))
    assert.equal((await persistence.loadRun('../../etc/passwd'))?.run.id, '../../etc/passwd')
  })

  it('trims run events to the last 2000', async () => {
    const big = record('run_big', 1)
    big.events = Array.from({ length: 2100 }, (_, i) => makeEvent(`e${i}`))
    await persistence.saveRun(big)
    const loaded = await persistence.loadRun('run_big')
    assert.equal(loaded?.events.length, 2000)
    assert.equal(loaded?.events[0].id, 'e100')
  })
})

describe('safeName', () => {
  it('replaces unsafe characters and caps the length', () => {
    assert.equal(safeName('run_1'), 'run_1')
    assert.equal(safeName('a/b:c d'), 'a_b_c_d')
    assert.equal(safeName('../x'), '.._x')
    assert.equal(safeName('x'.repeat(200)).length, 120)
  })
})
