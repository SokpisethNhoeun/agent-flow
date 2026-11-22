import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { appendFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { clearTranscriptCache, readClaudeImage, readClaudeTranscript } from '../src/worker/commands/claude-transcript.ts'
import { tempDir } from './helpers/fixtures.ts'

const line = (i: number, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ type: i % 2 ? 'assistant' : 'user', uuid: `m${i}`, message: { role: i % 2 ? 'assistant' : 'user', content: `message ${i}` }, ...extra })
const ids = (output: Awaited<ReturnType<typeof readClaudeTranscript>>) => (output?.kind === 'conversation' ? output.messages.map((m) => m.id) : [])

describe('readClaudeTranscript incremental tail', () => {
  it('returns the same answer while the file is unchanged and adds only appended messages', async () => {
    clearTranscriptCache()
    const { dir, cleanup } = await tempDir()
    try {
      const path = join(dir, 's.jsonl')
      await writeFile(path, [0, 1, 2].map((i) => line(i)).join('\n') + '\n')
      const first = await readClaudeTranscript(path)
      assert.deepEqual(ids(first), ['m0', 'm1', 'm2'])
      assert.equal(await readClaudeTranscript(path), first)

      // A half-written line is not shown until it is complete.
      const next = line(3)
      await appendFile(path, next.slice(0, 20))
      assert.deepEqual(ids(await readClaudeTranscript(path)), ['m0', 'm1', 'm2'])
      await appendFile(path, next.slice(20) + '\n' + line(4) + '\n')
      assert.deepEqual(ids(await readClaudeTranscript(path)), ['m0', 'm1', 'm2', 'm3', 'm4'])
    } finally {
      await cleanup()
    }
  })

  it('counts a complete last line that has no newline yet, without repeating it later', async () => {
    clearTranscriptCache()
    const { dir, cleanup } = await tempDir()
    try {
      const path = join(dir, 's.jsonl')
      await writeFile(path, line(0) + '\n' + line(1))
      assert.deepEqual(ids(await readClaudeTranscript(path)), ['m0', 'm1'])
      await appendFile(path, '\n' + line(2) + '\n')
      assert.deepEqual(ids(await readClaudeTranscript(path)), ['m0', 'm1', 'm2'])
    } finally {
      await cleanup()
    }
  })

  it('keeps the newest 160 messages and marks the answer truncated as the tail grows', async () => {
    clearTranscriptCache()
    const { dir, cleanup } = await tempDir()
    try {
      const path = join(dir, 's.jsonl')
      await writeFile(path, Array.from({ length: 150 }, (_, i) => line(i)).join('\n') + '\n')
      const first = await readClaudeTranscript(path)
      assert.equal(first?.kind === 'conversation' && first.truncated, false)
      await appendFile(path, Array.from({ length: 20 }, (_, i) => line(150 + i)).join('\n') + '\n')
      const grown = await readClaudeTranscript(path)
      const list = ids(grown)
      assert.deepEqual([list.length, list[0], list[list.length - 1]], [160, 'm10', 'm169'])
      assert.equal(grown?.kind === 'conversation' && grown.truncated, true)
    } finally {
      await cleanup()
    }
  })

  it('reads the whole tail again when the file is replaced by a shorter one', async () => {
    clearTranscriptCache()
    const { dir, cleanup } = await tempDir()
    try {
      const path = join(dir, 's.jsonl')
      await writeFile(path, [0, 1, 2].map((i) => line(i)).join('\n') + '\n')
      await readClaudeTranscript(path)
      await writeFile(path, line(7) + '\n')
      assert.deepEqual(ids(await readClaudeTranscript(path)), ['m7'])
    } finally {
      await cleanup()
    }
  })

  it('finds an image by its ref and serves repeated chunk reads from memory', async () => {
    clearTranscriptCache()
    const { dir, cleanup } = await tempDir()
    try {
      const path = join(dir, 's.jsonl')
      const image = { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'iVBORw0KGgo=' } }
      const entry = JSON.stringify({ type: 'user', uuid: 'img1', message: { role: 'user', content: [{ type: 'text', text: 'mentions img1 too' }, image] } })
      await writeFile(path, line(0) + '\n' + entry + '\n' + line(1) + '\n')
      const found = await readClaudeImage(path, 'img1|1')
      assert.deepEqual(found, { mediaType: 'image/png', data: 'iVBORw0KGgo=' })
      await writeFile(path, line(0) + '\n')
      assert.deepEqual(await readClaudeImage(path, 'img1|1'), found)
      assert.equal(await readClaudeImage(path, 'nope|1'), null)
    } finally {
      await cleanup()
    }
  })
})
