import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { isLiveWorker, mapWorkerState, OrchestrationAdapter } from '../src/worker/adapters/orchestration-adapter.ts'
import type { AgentRuntimeState } from '../src/shared/model.ts'
import { makeContext, type CliResponse } from './helpers/fake-context.ts'
import { INBOX, RAW_TASK, WORKER_LIST, WORKER_SHOW } from './helpers/fixtures.ts'

const RUN_LIST = { runs: [{ id: 'run_1', objective: 'Ship the public API' }, { id: 'run_legacy', objective: 'old', legacy: true }] }

function fullCli(overrides: Record<string, CliResponse> = {}): Record<string, CliResponse> {
  return {
    'orchestration run-list': RUN_LIST,
    'orchestration task-list': { tasks: [RAW_TASK] },
    'orchestration worker-list': WORKER_LIST,
    'orchestration worker-show': WORKER_SHOW,
    'orchestration inbox': INBOX,
    'orchestration gate-list': { gates: [] },
    ...overrides
  }
}

async function polled(overrides: Record<string, CliResponse> = {}) {
  const fake = makeContext({ cli: fullCli(overrides) })
  const adapter = new OrchestrationAdapter(fake.ctx)
  await adapter.poll()
  return { ...fake, adapter, state: fake.ctx.store.read() }
}

describe('OrchestrationAdapter: runs', () => {
  it('creates runs (skipping legacy) and a structural lead agent per run', async () => {
    const { state, ctx } = await polled()
    assert.deepEqual(Object.keys(state.runs), ['run_1'])
    assert.equal(state.runs.run_1.objective, 'Ship the public API')
    const lead = state.agents['lead:run_1']
    assert.ok(lead)
    assert.equal(lead.role, 'lead')
    assert.equal(lead.runId, 'run_1')
    assert.equal(lead.live, false)
    assert.ok(ctx.store.hasEvent('orchestration.started', 'run_1'))
  })

  it('does nothing without a CLI path', async () => {
    const fake = makeContext({ cli: fullCli(), cliPath: null })
    await new OrchestrationAdapter(fake.ctx).poll()
    assert.equal(fake.cli.calls.length, 0)
  })

  it('stops when run-list fails', async () => {
    const fake = makeContext({ cli: { 'orchestration run-list': () => ({ ok: false, code: 'unavailable', message: 'down' }) } })
    await new OrchestrationAdapter(fake.ctx).poll()
    assert.equal(fake.cli.calls.length, 1)
    assert.match(fake.logs.join('\n'), /run-list: unavailable down/)
  })

  it('picks up the coordinator handle from tasks and links it to the lead', async () => {
    const { state, ctx } = await polled({ 'orchestration task-list': { tasks: [{ ...RAW_TASK, created_by_terminal_handle: 'coord_1' }] } })
    assert.equal(state.runs.run_1.coordinatorHandle, 'coord_1')
    assert.equal(state.agents['lead:run_1'].terminalHandle, 'coord_1')
    assert.equal(ctx.identity.resolve({ terminalHandle: 'coord_1' }), 'lead:run_1')
  })
})

describe('OrchestrationAdapter: tasks', () => {
  it('maps a raw task: title, kind, state, deps, result, times', async () => {
    const { state, ctx } = await polled()
    const task = state.tasks.task_1
    assert.ok(task)
    assert.equal(task.runId, 'run_1')
    assert.equal(task.title, 'Review API')
    assert.equal(task.displayName, 'API review')
    assert.equal(task.kind, 'review')
    assert.equal(task.orcaStatus, 'completed')
    assert.equal(task.state, 'DONE')
    assert.deepEqual(task.deps, [])
    assert.equal(task.result?.outcome, 'succeeded')
    assert.equal(task.result?.message, 'done')
    assert.equal(task.createdAt, Date.parse('2026-11-18T06:05:41Z'))
    assert.equal(task.completedAt, Date.parse('2026-11-18T07:04:13.348Z'))
    assert.equal(state.runs.run_1.taskCount, 1)
    assert.equal(state.runs.run_1.startedAt, Date.parse('2026-11-18T06:05:41Z'))
    assert.ok(ctx.store.hasEvent('task.created', 'task_1'))
  })

  it('parses deps from a JSON string, an array, or a comma list', async () => {
    const tasks = [
      { ...RAW_TASK, id: 'a', status: 'pending', deps: '[]', result: null },
      { ...RAW_TASK, id: 'b', status: 'pending', deps: '["a"]', result: null },
      { ...RAW_TASK, id: 'c', status: 'pending', deps: ['a', 'b'], result: null },
      { ...RAW_TASK, id: 'd', status: 'pending', deps: 'a, b', result: null }
    ]
    const { state } = await polled({ 'orchestration task-list': { tasks }, 'orchestration worker-list': { workers: [] } })
    assert.deepEqual(state.tasks.a.deps, [])
    assert.deepEqual(state.tasks.b.deps, ['a'])
    assert.deepEqual(state.tasks.c.deps, ['a', 'b'])
    assert.deepEqual(state.tasks.d.deps, ['a', 'b'])
  })

  it('infers kind and maps state for several statuses', async () => {
    const tasks = [
      { ...RAW_TASK, id: 'impl', task_title: 'Implement login', display_name: null, status: 'dispatched', result: null },
      { ...RAW_TASK, id: 'tests', task_title: 'Write tests', display_name: null, status: 'dispatched', result: null },
      { ...RAW_TASK, id: 'merge', task_title: 'Merge branches', display_name: null, status: 'completed', result: '{"outcome":"succeeded"}' },
      { ...RAW_TASK, id: 'failed', task_title: 'Implement x', display_name: null, status: 'failed', result: '{"outcome":"failed"}' },
      { ...RAW_TASK, id: 'plain', task_title: 'Implement y', display_name: null, status: 'completed', result: 'all good, no json' }
    ]
    const { state } = await polled({ 'orchestration task-list': { tasks }, 'orchestration worker-list': { workers: [] } })
    assert.deepEqual([state.tasks.impl.kind, state.tasks.impl.state], ['task', 'RUNNING'])
    assert.deepEqual([state.tasks.tests.kind, state.tasks.tests.state], ['test', 'TESTING'])
    assert.deepEqual([state.tasks.merge.kind, state.tasks.merge.state], ['merge', 'MERGED'])
    assert.equal(state.tasks.failed.state, 'FAILED')
    assert.deepEqual(state.tasks.plain.result, { outcome: null, message: 'all good, no json', filesModified: [], raw: null })
  })

  it('redacts secrets in task specs', async () => {
    const { state } = await polled({ 'orchestration task-list': { tasks: [{ ...RAW_TASK, spec: 'use password=hunter22 to log in' }] } })
    assert.equal(state.tasks.task_1.spec, 'use password=[redacted] to log in')
  })
})

describe('OrchestrationAdapter: workers', () => {
  it('creates a dispatch agent per worker row and assigns it to the task', async () => {
    const { state, ctx } = await polled()
    const agent = state.agents['dispatch:ctx_1']
    assert.ok(agent)
    assert.equal(agent.role, 'worker')
    assert.equal(agent.dispatchId, 'ctx_1')
    assert.equal(agent.taskId, 'task_1')
    assert.equal(agent.runId, 'run_1')
    assert.equal(agent.parentId, 'lead:run_1')
    assert.equal(agent.terminalHandle, 'structworker_x')
    assert.equal(agent.workspaceId, 'repo::/path/wt')
    assert.equal(agent.worktreePath, '/path/wt')
    assert.equal(agent.title, 'API review')
    assert.equal(agent.state, 'done')
    assert.equal(agent.live, false)
    const task = state.tasks.task_1
    assert.equal(task.assigneeAgentId, 'dispatch:ctx_1')
    assert.deepEqual(task.dispatchIds, ['ctx_1'])
    assert.equal(task.retryCount, 0)
    const assigned = ctx.store.events().find((e) => e.kind === 'task.assigned')
    assert.equal(assigned?.entityId, 'task_1')
    assert.equal(assigned?.targetId, 'dispatch:ctx_1')
    assert.equal(ctx.identity.resolve({ terminalHandle: 'structworker_x' }), 'dispatch:ctx_1')
  })

  it('applies worker-show detail: agent, model, effort, paneKey, times, outcome', async () => {
    const { state, ctx, cli } = await polled()
    const agent = state.agents['dispatch:ctx_1']
    assert.equal(agent.agent, 'claude')
    assert.equal(agent.model, 'claude-opus-5-5')
    assert.equal(agent.effort, 'medium')
    assert.equal(agent.paneKey, 'pane-1')
    assert.equal(agent.startedAt, Date.parse('2026-11-20T09:26:47Z'))
    assert.equal(agent.endedAt, Date.parse('2026-11-20T09:44:11.466Z'))
    assert.equal(agent.outcome, 'succeeded')
    assert.equal(agent.failureCount, 0)
    assert.equal(ctx.identity.resolve({ paneKey: 'pane-1' }), 'dispatch:ctx_1')
    assert.deepEqual(cli.callsTo('orchestration worker-show')[0], ['orchestration', 'worker-show', '--dispatch', 'ctx_1', '--full'])
  })

  it('does not re-fetch detail for a settled worker whose row did not change', async () => {
    const { adapter, cli } = await polled()
    await adapter.poll()
    assert.equal(cli.callsTo('orchestration worker-show').length, 1)
  })

  it('ignores worker rows for unknown tasks', async () => {
    const { state } = await polled({ 'orchestration worker-list': { workers: [{ ...WORKER_LIST.workers[0], taskId: 'other' }], nextCursor: null } })
    assert.equal(state.agents['dispatch:ctx_1'], undefined)
  })

  it('follows worker-list cursors', async () => {
    const pages: CliResponse = (args: string[]) => {
      const cursor = args[args.indexOf('--cursor') + 1]
      if (!args.includes('--cursor')) return { ok: true, result: { workers: [], nextCursor: 'p2' } }
      assert.equal(cursor, 'p2')
      return { ok: true, result: WORKER_LIST }
    }
    const { state, cli } = await polled({ 'orchestration worker-list': pages })
    assert.equal(cli.callsTo('orchestration worker-list').length, 2)
    assert.ok(state.agents['dispatch:ctx_1'])
  })

  it('a retry dispatch emits task.retried and links its parent through creatorDispatchId', async () => {
    const workers = [
      { ...WORKER_LIST.workers[0], dispatchId: 'ctx_1', state: 'failed' },
      { ...WORKER_LIST.workers[0], dispatchId: 'ctx_2', state: 'running', liveness: 'alive', terminal: 'structworker_y' }
    ]
    const show: CliResponse = (args: string[]) => {
      const id = args[args.indexOf('--dispatch') + 1]
      const dispatch = id === 'ctx_2' ? { ...WORKER_SHOW.dispatch, id, retryOfDispatchId: 'ctx_1', creatorDispatchId: 'ctx_1', assigneeHandle: 'structworker_y', assigneePaneKey: 'pane-2', completedAt: null } : WORKER_SHOW.dispatch
      return { ok: true, result: { ...WORKER_SHOW, dispatch } }
    }
    const { state, ctx } = await polled({ 'orchestration task-list': { tasks: [{ ...RAW_TASK, status: 'dispatched', result: null }] }, 'orchestration worker-list': { workers, nextCursor: null }, 'orchestration worker-show': show })
    assert.deepEqual(state.tasks.task_1.dispatchIds, ['ctx_1', 'ctx_2'])
    assert.equal(state.tasks.task_1.retryCount, 1)
    assert.equal(state.tasks.task_1.assigneeAgentId, 'dispatch:ctx_2')
    const retry = state.agents['dispatch:ctx_2']
    assert.equal(retry.retryOfDispatchId, 'ctx_1')
    assert.equal(retry.parentId, 'dispatch:ctx_1')
    assert.equal(retry.live, true)
    assert.equal(retry.state, 'working')
    assert.ok(ctx.store.events().some((e) => e.kind === 'task.retried' && e.targetId === 'dispatch:ctx_2'))
  })
})

describe('OrchestrationAdapter: messages, gates, run state', () => {
  it('turns inbox messages into MessageRecords with resolved agent ids', async () => {
    const { state, ctx } = await polled()
    assert.equal(state.messages.length, 1)
    const message = state.messages[0]
    assert.equal(message.id, 'msg_1')
    assert.equal(message.runId, 'run_1')
    assert.equal(message.fromHandle, 'structworker_x')
    assert.equal(message.toHandle, 'run:run_1')
    assert.equal(message.fromAgentId, 'dispatch:ctx_1')
    assert.equal(message.toAgentId, 'lead:run_1')
    assert.equal(message.type, 'worker_done')
    assert.equal(message.subject, 'done')
    assert.equal(message.taskId, 'task_1')
    assert.equal(message.createdAt, Date.parse('2026-11-20T09:44:11Z'))
    const event = ctx.store.events().find((e) => e.kind === 'message.sent')
    assert.equal(event?.entityId, 'dispatch:ctx_1')
    assert.equal(event?.targetId, 'lead:run_1')
  })

  it('does not duplicate known messages on the next poll', async () => {
    const { adapter, ctx } = await polled()
    await adapter.poll()
    assert.equal(ctx.store.read().messages.length, 1)
    assert.equal(ctx.store.events().filter((e) => e.kind === 'message.sent').length, 1)
  })

  it('marks the run completed when every task is terminal', async () => {
    const { state } = await polled()
    assert.equal(state.runs.run_1.state, 'completed')
    assert.equal(state.runs.run_1.endedAt, Date.parse('2026-11-18T07:04:13.348Z'))
  })

  it('marks the run failed when a terminal task failed, active while one runs', async () => {
    const failed = await polled({ 'orchestration task-list': { tasks: [RAW_TASK, { ...RAW_TASK, id: 'task_2', status: 'failed', result: null }] } })
    assert.equal(failed.state.runs.run_1.state, 'failed')
    const active = await polled({ 'orchestration task-list': { tasks: [RAW_TASK, { ...RAW_TASK, id: 'task_2', status: 'dispatched', result: null }] } })
    assert.equal(active.state.runs.run_1.state, 'active')
    assert.equal(active.state.runs.run_1.endedAt, null)
  })

  it('emits orchestration.completed when an active run finishes', async () => {
    let status = 'dispatched'
    const fake = makeContext({ cli: fullCli({ 'orchestration task-list': () => ({ ok: true, result: { tasks: [{ ...RAW_TASK, status, result: status === 'completed' ? RAW_TASK.result : null }] } }) }) })
    const adapter = new OrchestrationAdapter(fake.ctx)
    await adapter.poll()
    assert.equal(fake.ctx.store.read().runs.run_1.state, 'active')
    status = 'completed'
    await adapter.poll()
    assert.equal(fake.ctx.store.read().runs.run_1.state, 'completed')
    assert.ok(fake.ctx.store.hasEvent('orchestration.completed', 'run_1'))
  })

  it('polls gates for active runs and blocks tasks with an open gate', async () => {
    const tasks = [{ ...RAW_TASK, status: 'dispatched', result: null }]
    const gates = { gates: [{ id: 'gate_1', task_id: 'task_1', question: 'Ship it?', status: 'pending', created_at: '2026-11-20 10:00:00' }] }
    const fake = makeContext({ cli: fullCli({ 'orchestration task-list': { tasks }, 'orchestration gate-list': gates }) })
    const adapter = new OrchestrationAdapter(fake.ctx)
    await adapter.poll()
    await adapter.poll()
    const state = fake.ctx.store.read()
    assert.equal(state.gates.gate_1?.question, 'Ship it?')
    assert.ok(fake.ctx.store.hasEvent('task.blocked', 'task_1'))
    await adapter.poll()
    assert.deepEqual(fake.ctx.store.read().tasks.task_1.gateIds, ['gate_1'])
    assert.equal(fake.ctx.store.read().tasks.task_1.state, 'BLOCKED')
  })

  it('hasActiveWork needs an active run with a live worker (keeps polling cheap otherwise)', async () => {
    const done = await polled()
    assert.equal(done.adapter.hasActiveWork, false)
    const idleRun = await polled({ 'orchestration task-list': { tasks: [{ ...RAW_TASK, status: 'dispatched', result: null }] } })
    assert.equal(idleRun.adapter.hasActiveWork, false, 'an active run without live workers does not speed up polling')
    const live = await polled({
      'orchestration task-list': { tasks: [{ ...RAW_TASK, status: 'dispatched', result: null }] },
      'orchestration worker-list': { workers: [{ ...WORKER_LIST.workers[0], state: 'running', liveness: 'alive' }], nextCursor: null }
    })
    assert.equal(live.adapter.hasActiveWork, true)
  })
})

describe('mapWorkerState / isLiveWorker', () => {
  const stateCases: [string, string | undefined, AgentRuntimeState][] = [
    ['succeeded', 'exited', 'done'],
    ['completed', undefined, 'done'],
    ['settled', undefined, 'done'],
    ['failed', undefined, 'failed'],
    ['outcome_unknown', undefined, 'failed'],
    ['stopped', undefined, 'done'],
    ['abandoned', undefined, 'done'],
    ['fenced', undefined, 'done'],
    ['cancelled', undefined, 'done'],
    ['blocked', 'alive', 'blocked'],
    ['permission', 'alive', 'blocked'],
    ['ready', 'alive', 'waiting'],
    ['ready', 'exited', 'idle'],
    ['ready', undefined, 'idle'],
    ['starting', undefined, 'working'],
    ['running', 'alive', 'working'],
    ['Working', undefined, 'working'],
    ['dispatched', undefined, 'working'],
    ['mystery', undefined, 'unknown']
  ]
  for (const [state, liveness, expected] of stateCases) {
    it(`mapWorkerState(${state}, ${liveness ?? '-'}) → ${expected}`, () => assert.equal(mapWorkerState({ state, liveness }), expected))
  }

  const liveCases: [string, string | undefined, boolean][] = [
    ['running', 'exited', false],
    ['running', 'stopped', false],
    ['succeeded', 'alive', true],
    ['ready', 'running', true],
    ['ready', 'live', true],
    ['running', undefined, true],
    ['starting', '', true],
    ['working', 'unverifiable', false],
    ['succeeded', undefined, false],
    ['ready', undefined, false]
  ]
  for (const [state, liveness, expected] of liveCases) {
    it(`isLiveWorker(${state}, ${liveness ?? '-'}) → ${expected}`, () => assert.equal(isLiveWorker({ state, liveness }), expected))
  }
})

describe('OrchestrationAdapter: cancellation', () => {
  it('maps Orca’s documented cancel (status failed, result "cancelled") to CANCELLED, not FAILED', async () => {
    const { state } = await polled({ 'orchestration task-list': { tasks: [{ ...RAW_TASK, status: 'failed', result: 'cancelled' }] } })
    assert.equal(state.tasks.task_1.state, 'CANCELLED')
    assert.equal(state.tasks.task_1.result?.outcome, 'cancelled')
  })

  it('keeps a plain-text failure as FAILED', async () => {
    const { state } = await polled({ 'orchestration task-list': { tasks: [{ ...RAW_TASK, status: 'failed', result: 'tests broke' }] } })
    assert.equal(state.tasks.task_1.state, 'FAILED')
  })
})
