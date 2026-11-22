import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeMessage, readWorkerOutput } from '../src/worker/commands/transcript.ts'
import { FakeCli } from './helpers/fake-context.ts'

const msg = (id: string, blocks: unknown[], role = 'assistant') => ({ id, role, timestamp: 1, source: 'transcript', blocks })

describe('normalizeMessage', () => {
  it('keeps text, thinking, tool calls and results, redacting secrets', () => {
    const m = normalizeMessage(msg('m1', [
      { type: 'text', text: 'done, token=supersecretvalue' },
      { type: 'thinking', text: 'hmm' },
      { type: 'tool-call', name: 'shell', input: { command: 'ls' } },
      { type: 'tool-result', output: 'a\nb', isError: true },
      { type: 'image', data: '…' }
    ]))!
    assert.equal(m.blocks.length, 4)
    assert.deepEqual(m.blocks[0], { type: 'text', text: 'done, token=[redacted]' })
    assert.deepEqual(m.blocks[2], { type: 'tool-call', name: 'shell', input: '{"command":"ls"}' })
    assert.deepEqual(m.blocks[3], { type: 'tool-result', output: 'a\nb', isError: true })
  })

  it('drops messages with nothing to show', () => {
    assert.equal(normalizeMessage(msg('m2', [{ type: 'image' }])), null)
    assert.equal(normalizeMessage(null), null)
  })
})

describe('readWorkerOutput', () => {
  it('pages forward through the transcript and returns a conversation', async () => {
    const cli = new FakeCli({
      'orchestration worker-read': (args: string[]) => {
        const second = args.includes('--cursor')
        return { ok: true, result: { source: 'transcript', provider: 'claude', transcript: { messages: [msg(second ? 'b' : 'a', [{ type: 'text', text: second ? 'two' : 'one' }])], nextCursor: second ? null : 'c1' } } }
      }
    })
    const out = await readWorkerOutput(cli, 'ctx_1')
    assert.equal(out?.kind, 'conversation')
    assert.deepEqual(out?.kind === 'conversation' && out.messages.map((m) => m.id), ['a', 'b'])
    assert.equal(cli.callsTo('orchestration worker-read').length, 2)
  })

  it('falls back to labelled terminal lines when Orca has no transcript', async () => {
    const cli = new FakeCli({ 'orchestration worker-read': { source: 'terminal', rows: [{ text: '\u001b[31mred\u001b[0m' }, 'plain'] } })
    const out = await readWorkerOutput(cli, 'ctx_1')
    assert.deepEqual(out, { kind: 'lines', source: 'terminal', lines: ['red', 'plain'], truncated: false })
  })

  it('returns null when the CLI fails', async () => {
    assert.equal(await readWorkerOutput(new FakeCli({}), 'ctx_1'), null)
  })
})
