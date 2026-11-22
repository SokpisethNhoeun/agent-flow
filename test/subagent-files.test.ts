import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, utimes, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { SubagentFilesAdapter } from '../src/worker/adapters/subagent-files-adapter.ts'
import { readClaudeTranscript, toMessage } from '../src/worker/commands/claude-transcript.ts'
import { makeContext } from './helpers/fake-context.ts'
import { makeAgent, tempDir } from './helpers/fixtures.ts'

async function setup(meta: Record<string, unknown>, ageMs = 0) {
  const { dir, cleanup } = await tempDir()
  const home = join(dir, 'acc', 'home')
  const subDir = join(home, 'projects', '-proj', 'sess-1', 'subagents')
  await mkdir(subDir, { recursive: true })
  const lines = [
    { type: 'user', timestamp: '2026-11-22T06:00:00.000Z', uuid: 'u1', message: { role: 'user', content: 'Count files, api_key=sk-abcdefghijklmnopqrstuvwx' } },
    { type: 'assistant', timestamp: '2026-11-22T06:00:02.000Z', uuid: 'u2', message: { role: 'assistant', content: [{ type: 'tool_use', name: 'Bash', input: { command: 'ls' } }] } },
    { type: 'user', timestamp: '2026-11-22T06:00:03.000Z', uuid: 'u3', message: { role: 'user', content: [{ type: 'tool_result', content: 'a\nb', is_error: false }] } },
    { type: 'assistant', timestamp: '2026-11-22T06:00:04.000Z', uuid: 'u4', message: { role: 'assistant', content: [{ type: 'text', text: '2 files' }] } }
  ]
  await writeFile(join(subDir, 'agent-x1.jsonl'), lines.map((l) => JSON.stringify(l)).join('\n') + '\n')
  await writeFile(join(subDir, 'agent-x1.meta.json'), JSON.stringify(meta))
  if (ageMs) {
    const t = (Date.now() - ageMs) / 1000
    await utimes(join(subDir, 'agent-x1.jsonl'), t, t)
    await utimes(join(subDir, 'agent-x1.meta.json'), t, t)
  }
  const fake = makeContext()
  fake.ctx.now = () => Date.now()
  const parent = makeAgent('term:p', { sessionId: 'sess-1', agent: 'claude', live: true, state: 'working', lastSeenAt: Date.now(), title: 'Parent' })
  fake.ctx.store.upsertAgent(parent.id, Date.now(), parent, () => parent)
  const adapter = new SubagentFilesAdapter(fake.ctx, () => [home])
  return { adapter, fake, cleanup, transcript: join(subDir, 'agent-x1.jsonl') }
}

describe('SubagentFilesAdapter', () => {
  it('finds a running subagent of a live Claude session and links it to its parent', async () => {
    const { adapter, fake, cleanup } = await setup({ agentType: 'Explore', description: 'Probe files', toolUseId: 'toolu_1', model: 'claude-haiku-5-5', finished: false })
    try {
      await adapter.scan()
      const sub = fake.ctx.store.read().agents['sub:toolu_1']
      assert.ok(sub, 'subagent node uses the hook call id, so both sources merge')
      assert.equal(sub.parentId, 'term:p')
      assert.equal(sub.subagentType, 'Explore')
      assert.equal(sub.model, 'claude-haiku-5-5')
      assert.equal(sub.state, 'working')
      assert.equal(sub.live, true)
      assert.equal(sub.startedAt, Date.parse('2026-11-22T06:00:00.000Z'))
      assert.ok(fake.ctx.store.events().some((e) => e.kind === 'subagent.spawned' && e.entityId === 'sub:toolu_1'))
    } finally {
      await cleanup()
    }
  })

  it('marks finished subagents done, and quiet unfinished ones as not live', async () => {
    const finished = await setup({ description: 'Done one', toolUseId: 'toolu_2', finished: true })
    try {
      await finished.adapter.scan()
      const sub = finished.fake.ctx.store.read().agents['sub:toolu_2']
      assert.equal(sub.state, 'done')
      assert.equal(sub.live, false)
    } finally {
      await finished.cleanup()
    }
    const quiet = await setup({ description: 'Quiet', toolUseId: 'toolu_3', finished: false }, 10 * 60 * 1000)
    try {
      await quiet.adapter.scan()
      const sub = quiet.fake.ctx.store.read().agents['sub:toolu_3']
      assert.equal(sub.live, false, 'no recent writes: not claimed as running')
      assert.equal(sub.state, 'unknown')
    } finally {
      await quiet.cleanup()
    }
  })

  it('serves the subagent transcript, redacted', async () => {
    const { adapter, fake, cleanup } = await setup({ description: 'Probe', toolUseId: 'toolu_4', finished: true })
    try {
      await adapter.scan()
      const path = await adapter.transcriptPathFor(fake.ctx.store.read().agents['sub:toolu_4'])
      assert.ok(path)
      const out = await readClaudeTranscript(path!)
      assert.equal(out?.kind, 'conversation')
      const messages = out?.kind === 'conversation' ? out.messages : []
      assert.equal(messages.length, 4)
      assert.ok(!JSON.stringify(messages).includes('sk-abcdefghijklmnopqrstuvwx'), 'secrets never leave the worker')
      assert.deepEqual(messages[1].blocks[0], { type: 'tool-call', name: 'Bash', input: '{"command":"ls"}' })
      assert.deepEqual(messages[3].blocks[0], { type: 'text', text: '2 files' })
    } finally {
      await cleanup()
    }
  })
})

describe('toMessage', () => {
  it('ignores non-message entries', () => {
    assert.equal(toMessage({ type: 'attachment' }), null)
    assert.equal(toMessage({ type: 'assistant', message: { role: 'assistant', content: [] } }), null)
  })
})
