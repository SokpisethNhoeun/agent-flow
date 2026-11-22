import assert from 'node:assert/strict'
import { test } from 'node:test'
import { countMatches, searchConversation } from '../src/ui/chat/search-conversation.ts'
import type { ConversationMessage } from '../src/ui/chat/conversation-to-thread.ts'

const msg = (id: string, role: string, blocks: ConversationMessage['blocks']): ConversationMessage => ({ id, role, ts: null, blocks })

const convo: ConversationMessage[] = [
  msg('1', 'user', [{ type: 'text', text: 'Please fix the Login bug' }]),
  msg('2', 'assistant', [{ type: 'text', text: 'Looking.' }, { type: 'tool-call', name: 'Grep', input: '{"pattern":"auth"}' }]),
  msg('3', 'user', [{ type: 'tool-result', output: 'src/login.ts:12 login()', isError: false }]),
  msg('4', 'assistant', [{ type: 'text', text: 'Done.' }])
]

test('empty query returns everything', () => {
  assert.equal(searchConversation(convo, '  ').messages.length, 4)
})

test('case-insensitive, counts every occurrence, keeps tool call/result pairs together', () => {
  const r = searchConversation(convo, 'LOGIN')
  assert.deepEqual(r.messages.map((m) => m.id), ['1', '2', '3'], 'the result matched, so its tool call stays')
  assert.equal(r.matches, 3)
  const call = searchConversation(convo, 'grep')
  assert.deepEqual(call.messages.map((m) => m.id), ['2', '3'], 'the call matched, so its result stays')
})

test('countMatches does not overlap', () => {
  assert.equal(countMatches('aaaa', 'aa'), 2)
  assert.equal(countMatches('abc', ''), 0)
})
