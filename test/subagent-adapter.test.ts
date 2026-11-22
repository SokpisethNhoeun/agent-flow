import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { SubagentAdapter, summarizeInput } from '../src/worker/adapters/subagent-adapter.ts'
import type { AgentRecord } from '../src/shared/model.ts'
import { makeContext } from './helpers/fake-context.ts'
import { makeAgent } from './helpers/fixtures.ts'

function setup(parents: AgentRecord[] = []) {
  const fake = makeContext()
  for (const parent of parents) {
    fake.ctx.store.upsertAgent(parent.id, 1, parent, () => parent)
    if (parent.terminalId) fake.ctx.identity.link(parent.id, { terminalId: parent.terminalId })
  }
  return { ...fake, adapter: new SubagentAdapter(fake.ctx) }
}

const PARENT = makeAgent('term:t1', { agent: 'claude', title: 'Main', terminalId: 't1', workspaceId: 'ws1', worktreePath: '/wt', branch: 'feat', runId: 'run_1', taskId: 'task_1', live: true, state: 'working' })

describe('SubagentAdapter', () => {
  for (const tool of ['Agent', 'Task']) {
    it(`tool "${tool}" spawns sub:<callId> under the terminal's agent`, () => {
      const { adapter, ctx } = setup([PARENT])
      adapter.onToolBefore({ agent: 'claude', workspaceId: 'ws1', terminalId: 't1', tool, callId: 'call_1', input: { description: 'Explore repo', subagent_type: 'Explore', prompt: 'look around', model: 'haiku' } })
      const sub = ctx.store.read().agents['sub:call_1']
      assert.ok(sub)
      assert.equal(sub.role, 'subagent')
      assert.equal(sub.parentId, 'term:t1')
      assert.equal(sub.callId, 'call_1')
      assert.equal(sub.subagentType, 'Explore')
      assert.equal(sub.title, 'Explore repo')
      assert.equal(sub.description, 'Explore repo')
      assert.equal(sub.model, 'haiku')
      assert.equal(sub.state, 'working')
      assert.equal(sub.live, true)
      assert.equal(sub.workspaceId, 'ws1')
      assert.equal(sub.worktreePath, '/wt')
      assert.equal(sub.branch, 'feat')
      assert.equal(sub.runId, 'run_1')
      assert.equal(sub.taskId, 'task_1')
      const event = ctx.store.events().find((e) => e.kind === 'subagent.spawned')
      assert.equal(event?.entityId, 'sub:call_1')
      assert.equal(event?.targetId, 'term:t1')
      const call = ctx.store.read().toolCalls.find((c) => c.id === 'call_1')
      assert.equal(call?.phase, 'started')
      assert.equal(call?.agentId, 'term:t1')
    })
  }

  it('defaults subagent type and uses the prompt as description', () => {
    const { adapter, ctx } = setup([PARENT])
    adapter.onToolBefore({ agent: 'claude', workspaceId: null, terminalId: 't1', tool: 'Agent', callId: 'c', input: { prompt: 'use token=abcdef123456 here' } })
    const sub = ctx.store.read().agents['sub:c']
    assert.equal(sub.subagentType, 'general-purpose')
    assert.equal(sub.description, 'use token=[redacted] here')
  })

  it('after-hook marks the subagent done', () => {
    const { adapter, ctx, clock } = setup([PARENT])
    adapter.onToolBefore({ agent: 'claude', workspaceId: 'ws1', terminalId: 't1', tool: 'Agent', callId: 'c1', input: { description: 'x' } })
    clock.advance(1000)
    adapter.onToolAfter({ agent: 'claude', workspaceId: 'ws1', terminalId: 't1', tool: 'Agent', callId: 'c1', input: {}, output: { content: 'ok' } })
    const sub = ctx.store.read().agents['sub:c1']
    assert.equal(sub.state, 'done')
    assert.equal(sub.outcome, 'success')
    assert.equal(sub.live, false)
    assert.equal(sub.endedAt, clock.value)
    assert.ok(ctx.store.hasEvent('subagent.completed', 'sub:c1'))
    assert.equal(ctx.store.read().toolCalls.find((c) => c.id === 'c1')?.phase, 'finished')
  })

  it('after-hook marks the subagent failed on is_error / isError / status error', () => {
    const outputs = [{ is_error: true }, { isError: true }, { status: 'error' }, { status: 'failed' }]
    outputs.forEach((output, i) => {
      const { adapter, ctx } = setup([PARENT])
      adapter.onToolBefore({ agent: 'claude', workspaceId: 'ws1', terminalId: 't1', tool: 'Task', callId: `c${i}`, input: {} })
      adapter.onToolAfter({ agent: 'claude', workspaceId: 'ws1', terminalId: 't1', tool: 'Task', callId: `c${i}`, input: {}, output })
      const sub = ctx.store.read().agents[`sub:c${i}`]
      assert.equal(sub.state, 'failed', JSON.stringify(output))
      assert.equal(sub.outcome, 'failure')
    })
  })

  it('after-hook without a known subagent does nothing', () => {
    const { adapter, ctx } = setup([PARENT])
    adapter.onToolAfter({ agent: 'claude', workspaceId: 'ws1', terminalId: 't1', tool: 'Agent', callId: 'ghost', input: {} })
    assert.equal(ctx.store.read().agents['sub:ghost'], undefined)
  })

  it('other tools only record tool calls', () => {
    const { adapter, ctx } = setup([PARENT])
    adapter.onToolBefore({ agent: 'claude', workspaceId: 'ws1', terminalId: 't1', tool: 'Bash', callId: 'b1', input: { command: 'npm test' } })
    adapter.onToolAfter({ agent: 'claude', workspaceId: 'ws1', terminalId: 't1', tool: 'Bash', callId: 'b1', input: { command: 'npm test' } })
    const agents = Object.keys(ctx.store.read().agents)
    assert.deepEqual(agents, ['term:t1'])
    const calls = ctx.store.read().toolCalls
    assert.equal(calls.length, 1)
    assert.deepEqual({ ...calls[0], at: 0 }, { id: 'b1', agentId: 'term:t1', terminalId: 't1', tool: 'Bash', summary: 'npm test', at: 0, phase: 'finished' })
    assert.equal(ctx.store.events().length, 0)
  })

  it('tool calls without a call id get unique fallback keys', () => {
    const { adapter, ctx } = setup([PARENT])
    adapter.onToolBefore({ agent: 'claude', workspaceId: 'ws1', terminalId: 't1', tool: 'Read', input: { file_path: '/a' } })
    adapter.onToolBefore({ agent: 'claude', workspaceId: 'ws1', terminalId: 't1', tool: 'Read', input: { file_path: '/b' } })
    assert.equal(ctx.store.read().toolCalls.length, 2)
  })

  it('attributes by workspace only when exactly one live candidate of that agent kind is there', () => {
    const live = makeAgent('term:a', { agent: 'claude', workspaceId: 'ws1', live: true })
    const one = setup([live])
    one.adapter.onToolBefore({ agent: 'claude', workspaceId: 'ws1', tool: 'Agent', callId: 'c', input: {} })
    assert.equal(one.ctx.store.read().agents['sub:c'].parentId, 'term:a')

    const two = setup([live, makeAgent('term:b', { agent: 'claude', workspaceId: 'ws1', live: true })])
    two.adapter.onToolBefore({ agent: 'claude', workspaceId: 'ws1', tool: 'Agent', callId: 'c', input: {} })
    assert.equal(two.ctx.store.read().agents['sub:c'].parentId, null)

    const otherKind = setup([live, makeAgent('term:b', { agent: 'codex', workspaceId: 'ws1', live: true })])
    otherKind.adapter.onToolBefore({ agent: 'claude', workspaceId: 'ws1', tool: 'Agent', callId: 'c', input: {} })
    assert.equal(otherKind.ctx.store.read().agents['sub:c'].parentId, 'term:a')

    const notLive = setup([makeAgent('term:a', { agent: 'claude', workspaceId: 'ws1', live: false })])
    notLive.adapter.onToolBefore({ agent: 'claude', workspaceId: 'ws1', tool: 'Agent', callId: 'c', input: {} })
    assert.equal(notLive.ctx.store.read().agents['sub:c'].parentId, null)

    const noWorkspace = setup([live])
    noWorkspace.adapter.onToolBefore({ agent: 'claude', workspaceId: null, tool: 'Agent', callId: 'c', input: {} })
    assert.equal(noWorkspace.ctx.store.read().agents['sub:c'].parentId, null)
  })

  it('live subagents are not candidates for workspace attribution', () => {
    const { adapter, ctx } = setup([makeAgent('term:a', { agent: 'claude', workspaceId: 'ws1', live: true })])
    adapter.onToolBefore({ agent: 'claude', workspaceId: 'ws1', tool: 'Agent', callId: 'first', input: {} })
    adapter.onToolBefore({ agent: 'claude', workspaceId: 'ws1', tool: 'Agent', callId: 'second', input: {} })
    assert.equal(ctx.store.read().agents['sub:second'].parentId, 'term:a')
  })
})

describe('summarizeInput', () => {
  it('picks the most descriptive field and redacts', () => {
    assert.equal(summarizeInput('Bash', { command: 'ls' }), 'ls')
    assert.equal(summarizeInput('Read', { file_path: '/x' }), '/x')
    assert.equal(summarizeInput('Grep', { pattern: 'foo' }), 'foo')
    assert.equal(summarizeInput('Bash', { command: 'export API_KEY=abcdef123456' }), 'export API_KEY=[redacted]')
    assert.equal(summarizeInput('Mystery', null), 'Mystery')
    assert.equal(summarizeInput('Bash', { command: 'x'.repeat(500) }).length, 160)
  })
})
