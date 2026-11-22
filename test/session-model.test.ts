import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readClaudeModel, readCodexModel } from '../src/worker/adapters/session-model-adapter.ts'

describe('model and effort from session files', () => {
  it('Claude: newest assistant turn wins; synthetic entries are skipped', () => {
    const lines = [
      JSON.stringify({ type: 'assistant', message: { model: 'claude-sonnet-5-5' }, effort: 'high' }),
      JSON.stringify({ type: 'user', message: { role: 'user', content: 'x' } }),
      JSON.stringify({ type: 'assistant', message: { model: 'claude-opus-5-5' }, effort: 'medium', perTurnEffort: 'xhigh' }),
      JSON.stringify({ type: 'assistant', message: { model: '<synthetic>' } }),
      '{"type":"assistant","message":{"mod'
    ]
    assert.deepEqual(readClaudeModel(lines), { model: 'claude-opus-5-5', effort: 'xhigh' })
  })

  it('Codex: newest turn_context wins', () => {
    const lines = [
      JSON.stringify({ type: 'session_meta', payload: { id: 'x' } }),
      JSON.stringify({ type: 'turn_context', payload: { model: 'gpt-6-luna', effort: 'medium' } }),
      JSON.stringify({ type: 'turn_context', payload: { model: 'gpt-6.1-sol', effort: 'high' } })
    ]
    assert.deepEqual(readCodexModel(lines), { model: 'gpt-6.1-sol', effort: 'high' })
  })

  it('reports nothing rather than guessing', () => {
    assert.deepEqual(readClaudeModel([]), { model: null, effort: null })
    assert.deepEqual(readCodexModel(['garbage']), { model: null, effort: null })
  })
})
