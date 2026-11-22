import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { canonicalize, chatSessionIdFromPaneKey, operationId, payloadFingerprint } from '../src/worker/runtime-rpc/chat-send.ts'
import { callOrcaRuntime } from '../src/worker/runtime-rpc/orca-runtime-client.ts'
import { newAgent } from '../src/worker/context.ts'
import { command, makeRouter } from './helpers/router-setup.ts'

describe('chat send helpers', () => {
  it('reads the Orca session id from a chat pane key', () => {
    assert.equal(chatSessionIdFromPaneKey('structured-agent-session-claude_54e48b23_afd2:tab-1'), 'claude_54e48b23_afd2')
    assert.equal(chatSessionIdFromPaneKey('group:pane'), null)
    assert.equal(chatSessionIdFromPaneKey(null), null)
  })

  it('canonicalizes like Orca: sorted keys, undefined dropped, arrays kept in order', () => {
    assert.equal(canonicalize({ b: 1, a: [2, { d: undefined, c: 'x' }] }), '{"a":[2,{"c":"x"}],"b":1}')
    const fields = { body: { kind: 'message', role: 'user', blocks: [{ type: 'text', text: 'hi' }] } }
    const expected = createHash('sha256').update('{"fields":{"body":{"blocks":[{"text":"hi","type":"text"}],"kind":"message","role":"user"}},"method":"agentSession.send","sessionId":"s1"}').digest('hex')
    assert.equal(payloadFingerprint('agentSession.send', 's1', fields), expected)
  })

  it('makes operation ids in Orca’s format', () => {
    assert.match(operationId(1795330000000), /^\d{13}-[0-9a-f]{32}$/)
  })

  it('the runtime client refuses any method outside its allowlist', async () => {
    await assert.rejects(callOrcaRuntime('agentSession.delete', {}), (e: Error & { code?: string }) => e.code === 'not_permitted')
  })
})

describe('agent.prompt into a chat session', () => {
  function withChat(r: ReturnType<typeof makeRouter>) {
    const agent = { ...newAgent('pane:chat', 'agent', 1), paneKey: 'structured-agent-session-claude_abc_123:tab' }
    r.ctx.store.upsertAgent(agent.id, 1, agent, () => agent)
  }

  it('sends through the chat route with the Orca session id', async () => {
    const r = makeRouter()
    const sent: [string, string][] = []
    ;(r.router as unknown as { deps: { sendChat: (s: string, t: string) => Promise<unknown> } }).deps.sendChat = async (s, t) => void sent.push([s, t])
    withChat(r)
    const response = await r.router.handle(command('agent.prompt', { agentId: 'pane:chat', text: 'hello chat' }))
    assert.deepEqual(response, { ok: true, result: { via: 'chat-session', delivered: true } })
    assert.deepEqual(sent, [['claude_abc_123', 'hello chat']])
  })

  it('reports Orca’s refusal instead of pretending', async () => {
    const r = makeRouter()
    ;(r.router as unknown as { deps: { sendChat: () => Promise<unknown> } }).deps.sendChat = async () => {
      throw Object.assign(new Error('fence moved'), { code: 'conflict' })
    }
    withChat(r)
    const response = await r.router.handle(command('agent.prompt', { agentId: 'pane:chat', text: 'x' }))
    assert.equal(response.ok, false)
    assert.equal(!response.ok && response.error.code, 'conflict')
  })
})
