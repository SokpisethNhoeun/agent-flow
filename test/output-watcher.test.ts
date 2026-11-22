import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { test } from 'node:test'
import type { FSWatcher } from 'node:fs'
import { appendFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { OutputWatcher, type WatchFactory } from '../src/worker/commands/output-watcher.ts'
import { tempDir } from './helpers/fixtures.ts'

function fakeFactory() {
  const open = new Map<string, { fire: () => void; closed: boolean }>()
  const factory: WatchFactory = (path, onChange) => {
    const emitter = new EventEmitter() as EventEmitter & { close: () => void }
    const entry = { fire: onChange, closed: false }
    emitter.close = () => (entry.closed = true)
    open.set(path, entry)
    return emitter as unknown as FSWatcher
  }
  return { factory, open }
}

const tick = (ms: number) => new Promise((r) => setTimeout(r, ms))

test('pushes one notice per burst of changes for a tracked agent', async () => {
  const { factory, open } = fakeFactory()
  const watcher = new OutputWatcher({ watchFile: factory, debounceMs: 20 })
  const heard: string[] = []
  watcher.subscribe((id) => heard.push(id))
  assert.equal(watcher.track('a1', '/t/a1.jsonl'), true)
  open.get('/t/a1.jsonl')!.fire()
  open.get('/t/a1.jsonl')!.fire()
  open.get('/t/a1.jsonl')!.fire()
  await tick(40)
  assert.deepEqual(heard, ['a1'])
  watcher.dispose()
  assert.equal(open.get('/t/a1.jsonl')!.closed, true)
})

test('caps open watches and drops ones nobody read for a while', () => {
  let now = 0
  const { factory, open } = fakeFactory()
  const watcher = new OutputWatcher({ watchFile: factory, max: 2, idleMs: 1000, now: () => now })
  watcher.track('a1', '/a1')
  now = 10
  watcher.track('a2', '/a2')
  now = 20
  watcher.track('a3', '/a3')
  assert.equal(watcher.size, 2)
  assert.equal(open.get('/a1')!.closed, true, 'least recently read is closed first')
  now = 5000
  watcher.track('a4', '/a4')
  assert.equal(watcher.size, 1, 'idle watches are swept')
  watcher.dispose()
})

test('an idle watch does not notify, and a missing file just reports no push', async () => {
  let now = 0
  const { factory, open } = fakeFactory()
  const watcher = new OutputWatcher({ watchFile: factory, idleMs: 100, debounceMs: 5, now: () => now })
  const heard: string[] = []
  watcher.subscribe((id) => heard.push(id))
  watcher.track('a1', '/a1')
  now = 500
  open.get('/a1')!.fire()
  await tick(20)
  assert.deepEqual(heard, [])
  assert.equal(watcher.size, 0)
  const real = new OutputWatcher()
  assert.equal(real.track('x', '/definitely/not/here.jsonl'), false)
  real.dispose()
})

test('real file appends are noticed', async () => {
  const tmp = await tempDir()
  try {
    const file = join(tmp.dir, 's.jsonl')
    await writeFile(file, '{}\n')
    const watcher = new OutputWatcher({ debounceMs: 20 })
    const heard = new Promise<string>((resolve) => watcher.subscribe(resolve))
    assert.equal(watcher.track('s1', file), true)
    await tick(30)
    await appendFile(file, '{"more":1}\n')
    assert.equal(await Promise.race([heard, tick(2000).then(() => 'timeout')]), 's1')
    watcher.dispose()
  } finally {
    await tmp.cleanup()
  }
})

test('terminal output: a poke reaches views only for agents someone read recently', async () => {
  let now = 0
  const watcher = new OutputWatcher({ debounceMs: 5, idleMs: 1000, now: () => now })
  const heard: string[] = []
  watcher.subscribe((id) => heard.push(id))
  watcher.poke('t1')
  watcher.noteInterest('t1')
  watcher.poke('t1')
  watcher.poke('t1')
  await tick(20)
  assert.deepEqual(heard, ['t1'], 'not before interest; one notice per burst')
  now = 5000
  watcher.poke('t1')
  await tick(20)
  assert.deepEqual(heard, ['t1'], 'interest expires')
  watcher.dispose()
})
