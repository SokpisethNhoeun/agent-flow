import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { toThread, type ConversationMessage } from '../src/ui/chat/conversation-to-thread.ts'

const msg = (id: string, role: string, blocks: ConversationMessage['blocks'], extra: Partial<ConversationMessage> = {}): ConversationMessage => ({ id, role, ts: 1, blocks, ...extra })

describe('toThread', () => {
  it('pairs tool results with the tool calls that asked for them, and merges assistant steps', () => {
    const thread = toThread([
      msg('u1', 'user', [{ type: 'text', text: 'take a screenshot' }]),
      msg('a1', 'assistant', [{ type: 'thinking', text: 'hmm' }, { type: 'tool-call', name: 'Screenshot', input: '{}' }], { model: 'claude-opus-5-5', effort: 'high' }),
      msg('u2', 'user', [{ type: 'tool-result', output: 'saved', isError: false, images: [{ ref: 'u2|0|1', mediaType: 'image/png', bytes: 1000 }] }]),
      msg('a2', 'assistant', [{ type: 'text', text: 'Here it is.' }], { model: 'claude-opus-5-5', effort: 'high' })
    ])
    assert.equal(thread.length, 2, 'one user bubble, one assistant turn')
    const [user, assistant] = thread
    assert.equal(user.role, 'user')
    assert.deepEqual(assistant.content.map((p) => p.type), ['reasoning', 'tool-call', 'data-image', 'text'])
    const call = assistant.content[1] as { result?: string; toolName: string }
    assert.equal(call.toolName, 'Screenshot')
    assert.equal(call.result, 'saved')
    assert.deepEqual(assistant.metadata.custom, { model: 'claude-opus-5-5', effort: 'high' })
  })

  it('keeps images people sent inside their own bubble', () => {
    const [user] = toThread([msg('u1', 'user', [{ type: 'text', text: 'look' }, { type: 'image', image: { ref: 'u1|1', mediaType: 'image/jpeg', bytes: 10 } }])])
    assert.deepEqual(user.content.map((p) => p.type), ['text', 'data-image'])
  })

  it('a result with no matching call still shows', () => {
    const thread = toThread([
      msg('a1', 'assistant', [{ type: 'text', text: 'working' }]),
      msg('u1', 'user', [{ type: 'tool-result', output: 'late output', isError: true }])
    ])
    const part = thread[0].content[1] as { result?: string; isError?: boolean }
    assert.equal(part.result, 'late output')
    assert.equal(part.isError, true)
  })
})

describe('toThread: user messages never carry tool parts', () => {
  it('a tool result before any assistant turn becomes text (assistant-ui refuses tool parts in user messages)', () => {
    const thread = toThread([
      msg('u0', 'user', [{ type: 'tool-result', output: 'earlier output', isError: false, images: [{ ref: 'u0|0|0', mediaType: 'image/png', bytes: 5 }] }]),
      msg('u1', 'user', [{ type: 'text', text: 'hi' }, { type: 'tool-result', output: 'x', isError: false }])
    ])
    for (const m of thread) if (m.role === 'user') for (const p of m.content) assert.ok(p.type === 'text' || p.type === 'data-image', `user part ${p.type}`)
    assert.ok(thread[0].content.some((p) => p.type === 'data-image'))
  })
})
