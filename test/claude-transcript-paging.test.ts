import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { readClaudeTranscript } from '../src/worker/commands/claude-transcript.ts'
import { tempDir } from './helpers/fixtures.ts'

describe('readClaudeTranscript paging', () => {
  it('returns the newest 160, then the batch before a given message, then nothing more', async () => {
    const { dir, cleanup } = await tempDir()
    try {
      const path = join(dir, 's.jsonl')
      const lines = Array.from({ length: 400 }, (_, i) => JSON.stringify({ type: i % 2 ? 'assistant' : 'user', uuid: `m${i}`, timestamp: new Date(1795330000000 + i * 1000).toISOString(), message: { role: i % 2 ? 'assistant' : 'user', content: `message ${i}` } }))
      await writeFile(path, lines.join('\n') + '\n')
      const newest = await readClaudeTranscript(path)
      assert.equal(newest?.kind, 'conversation')
      const n = newest?.kind === 'conversation' ? newest.messages : []
      assert.equal(n.length, 160)
      assert.equal(n[0].id, 'm240')
      assert.equal(newest?.kind === 'conversation' && newest.truncated, true)

      const page2 = await readClaudeTranscript(path, { beforeId: 'm240' })
      const p2 = page2?.kind === 'conversation' ? page2.messages : []
      assert.deepEqual([p2[0].id, p2[p2.length - 1].id, p2.length], ['m80', 'm239', 160])

      const page3 = await readClaudeTranscript(path, { beforeId: 'm80' })
      const p3 = page3?.kind === 'conversation' ? page3.messages : []
      assert.deepEqual([p3[0].id, p3.length, page3?.kind === 'conversation' && page3.truncated], ['m0', 80, false])

      const none = await readClaudeTranscript(path, { beforeId: 'm0' })
      assert.equal(none?.kind === 'conversation' && none.messages.length, 0)
    } finally {
      await cleanup()
    }
  })
})
