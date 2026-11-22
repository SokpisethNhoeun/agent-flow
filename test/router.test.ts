import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import type { CommandResponse } from '../src/shared/commands.ts'
import { newAgent } from '../src/worker/context.ts'
import { command, makeRouter } from './helpers/router-setup.ts'

function errorOf(response: CommandResponse) {
  assert.equal(response.ok, false, JSON.stringify(response))
  return response.ok ? null! : response
}

describe('CommandRouter: validation and gating', () => {
  it('returns invalid_params for a command that fails validation', async () => {
    const { router } = makeRouter()
    const response = errorOf(await router.handle({ requestId: 'bad', kind: 'dashboard.info' }))
    assert.equal(response.error.code, 'invalid_params')
    const unknownField = errorOf(await router.handle(command('dashboard.info', { x: 1 })))
    assert.equal(unknownField.error.code, 'invalid_params')
  })

  it('returns not_permitted when the caller filter refuses the kind', async () => {
    const { router, host } = makeRouter({ host: { 'terminal.focus': () => ({ ok: true }) } })
    const response = errorOf(await router.handle(command('terminal.focus', { terminalId: 't1' }), () => false))
    assert.equal(response.error.code, 'not_permitted')
    assert.equal(host.calls.length, 0)
  })

  it('requires confirmation for destructive commands', async () => {
    const { router, cli } = makeRouter()
    const response = errorOf(await router.handle(command('agent.stop', { agentId: 'dispatch:ctx_1' })))
    assert.equal(response.error.code, 'confirmation_required')
    const cancel = errorOf(await router.handle(command('task.cancel', { taskId: 'task_1', runId: 'run_1' })))
    assert.equal(cancel.error.code, 'confirmation_required')
    assert.equal(cli.calls.length, 0)
  })

  it('read-only commands (viewer.ping, dashboard.info) never trigger a re-scan', async () => {
    const { router, refreshes } = makeRouter()
    assert.equal((await router.handle(command('viewer.ping', {}))).ok, true)
    assert.equal((await router.handle(command('dashboard.info', {}))).ok, true)
    assert.equal(refreshes(), 0)
  })

  it('returns unsupported when the host lacks the method', async () => {
    const { router } = makeRouter()
    assert.equal(errorOf(await router.handle(command('terminal.focus', { terminalId: 't1' }))).error.code, 'unsupported')
  })

  it('model.change is unsupported', async () => {
    const { router } = makeRouter()
    assert.equal(errorOf(await router.handle(command('model.change', { agentId: 'a', model: 'opus' }))).error.code, 'unsupported')
  })
})

describe('CommandRouter: execution', () => {
  it('runs each requestId once and returns the same promise', async () => {
    let calls = 0
    const { router, host, refreshes } = makeRouter({ host: { 'terminal.focus': () => ({ focused: ++calls }) } })
    const request = command('terminal.focus', { terminalId: 't1' })
    const first = router.handle(request)
    const second = router.handle({ ...request })
    assert.equal(first, second)
    assert.deepEqual(await first, { ok: true, result: { focused: 1 } })
    assert.deepEqual(await router.handle(request), { ok: true, result: { focused: 1 } })
    assert.equal(host.callsTo('terminal.focus').length, 1)
    assert.equal(refreshes(), 1)
  })

  it('records command.executed / command.failed events', async () => {
    const { router, ctx } = makeRouter({ host: { 'terminal.focus': () => ({}) } })
    await router.handle(command('terminal.focus', { terminalId: 't1' }))
    assert.ok(ctx.store.hasEvent('command.executed', 't1'))
  })

  it('maps a host error code and redacts its message', async () => {
    const { router } = makeRouter({
      host: {
        'terminal.focus': () => {
          throw Object.assign(new Error('denied for token=abcdef123456'), { code: 'capability_denied' })
        }
      }
    })
    const response = errorOf(await router.handle(command('terminal.focus', { terminalId: 't1' })))
    assert.equal(response.error.code, 'capability_denied')
    assert.equal(response.error.message, 'denied for token=[redacted]')
  })

  it('reading a terminal agent registers interest so its status changes announce new output', async () => {
    const { router, ctx, interest } = makeRouter({ host: { 'terminal.read': () => ({ lines: ['hello'], truncated: false }) } })
    ctx.store.upsertAgent('term_agent', 1, { terminalId: 'tx', live: true, state: 'working' }, () => newAgent('term_agent', 'agent', 1))
    const response = await router.handle(command('agent.readOutput', { agentId: 'term_agent' }))
    assert.equal(response.ok, true, JSON.stringify(response))
    assert.equal((response as { result: { events: boolean } }).result.events, true)
    assert.deepEqual(interest, ['term_agent'])
  })

  it('terminal.read strips ANSI and redacts lines', async () => {
    const { router } = makeRouter({ host: { 'terminal.read': () => ({ lines: ['\u001b[32mok\u001b[0m', 'password=hunter22'], truncated: false }) } })
    const response = await router.handle(command('terminal.read', { terminalId: 't1' }))
    assert.deepEqual(response, { ok: true, result: { kind: 'lines', source: 'terminal', lines: ['ok', 'password=[redacted]'], truncated: false } })
  })

  it('agent.launch remembers the terminal it opened', async () => {
    const { router, ownTerminals, host } = makeRouter({ host: { 'agent.launch': () => ({ terminalId: 'new-term' }) } })
    await router.handle(command('agent.launch', { workspaceId: 'ws1', agent: 'claude' }))
    assert.ok(ownTerminals.has('new-term'))
    assert.deepEqual(host.callsTo('agent.launch')[0], { workspaceId: 'ws1', agent: 'claude' })
  })

  it('labels.update merges with current labels', async () => {
    const { router, labelUpdates } = makeRouter()
    const response = await router.handle(command('labels.update', { accountTeams: { acc1: 'Team A' } }))
    assert.equal(response.ok, true)
    assert.deepEqual(labelUpdates[0], { accountTeams: { acc1: 'Team A' }, agentRoles: {}, leadAccount: null, projectNames: {}, projectColors: {}, projectRules: {} })
  })

  it('history.load reports not_found for unknown runs', async () => {
    const { router } = makeRouter()
    assert.equal(errorOf(await router.handle(command('history.load', { runId: 'nope' }))).error.code, 'not_found')
  })
})

describe('CommandRouter: coordinator commands', () => {
  it('without act-as-coordinator returns coordinator_required with a quoted manual command', async () => {
    const { router, cli } = makeRouter({ coordinatorHandle: 'coord_1' })
    const response = errorOf(await router.handle(command('task.create', { runId: 'run_1', title: "Fix the user's bug", spec: 'Do it; carefully', deps: ['task_1'] })))
    assert.equal(response.error.code, 'coordinator_required')
    assert.ok(response.manual)
    assert.ok(response.manual.command.startsWith('orca orchestration task-create'), response.manual.command)
    assert.equal(response.manual.command, `orca orchestration task-create --run=run_1 '--task-title=Fix the user'\\''s bug' '--spec=Do it; carefully' '--deps=["task_1"]'`)
    assert.equal(cli.calls.length, 0)
  })

  it('with act-as-coordinator but no known coordinator still returns the manual command', async () => {
    const { router, cli } = makeRouter({ actAsCoordinator: true, coordinatorHandle: null })
    const response = errorOf(await router.handle(command('task.create', { runId: 'run_1', title: 'T', spec: 'S' })))
    assert.equal(response.error.code, 'coordinator_required')
    assert.match(response.error.message, /no terminal handle/)
    assert.equal(cli.calls.length, 0)
  })

  it('with act-as-coordinator and a coordinator handle runs the CLI with --from', async () => {
    const { router, cli } = makeRouter({ actAsCoordinator: true, coordinatorHandle: 'coord_1', cli: { 'orchestration task-create': { id: 'task_9' } } })
    const response = await router.handle(command('task.create', { runId: 'run_1', title: 'T', spec: 'S' }))
    assert.deepEqual(response, { ok: true, result: { id: 'task_9' } })
    const call = cli.calls[0]
    assert.deepEqual(call.args, ['orchestration', 'task-create', '--run=run_1', '--task-title=T', '--spec=S', '--from=coord_1'])
    assert.equal(call.options?.timeoutMs, 90000)
  })

  it('a CLI failure keeps the manual command', async () => {
    const { router } = makeRouter({ actAsCoordinator: true, coordinatorHandle: 'coord_1', cli: { 'orchestration send': () => ({ ok: false, code: 'not_permitted', message: 'nope' }) } })
    const response = errorOf(await router.handle(command('message.send', { runId: 'run_1', to: 'dispatch_x', subject: 'hi', body: 'there' })))
    assert.equal(response.error.code, 'not_permitted')
    assert.match(response.manual?.command ?? '', /^orca orchestration send --run=run_1 --to=dispatch_x/)
  })

  it('refuses unknown runs and tasks from another run', async () => {
    const { router } = makeRouter({ actAsCoordinator: true, coordinatorHandle: 'coord_1' })
    assert.equal(errorOf(await router.handle(command('task.create', { runId: 'run_other', title: 'T', spec: 'S' }))).error.code, 'invalid_params')
    assert.equal(errorOf(await router.handle(command('task.retry', { runId: 'run_1', taskId: 'task_missing' }))).error.code, 'invalid_params')
  })
})

describe('CommandRouter: agent.stop / task.cancel / inspect', () => {
  it('agent.stop on a dispatch agent runs worker-stop', async () => {
    const { router, cli, ctx } = makeRouter({ cli: { 'orchestration worker-stop': { stopped: true } } })
    ctx.store.upsertAgent('dispatch:ctx_1', 1, { dispatchId: 'ctx_1', live: true }, () => newAgent('dispatch:ctx_1', 'worker', 0))
    const response = await router.handle(command('agent.stop', { agentId: 'dispatch:ctx_1' }, { confirmed: true }))
    assert.deepEqual(response, { ok: true, result: { stopped: true } })
    assert.deepEqual(cli.calls[0].args, ['orchestration', 'worker-stop', '--dispatch', 'ctx_1'])
  })

  it('agent.stop on a terminal Agent Flow did not open is not permitted', async () => {
    const { router, ctx, host } = makeRouter({ host: { 'terminal.close': () => ({}) } })
    ctx.store.upsertAgent('term:t1', 1, { terminalId: 't1', live: true }, () => newAgent('term:t1', 'agent', 0))
    const response = errorOf(await router.handle(command('agent.stop', { agentId: 'term:t1' }, { confirmed: true })))
    assert.equal(response.error.code, 'not_permitted')
    assert.equal(host.calls.length, 0)
  })

  it('agent.stop closes a terminal Agent Flow opened', async () => {
    const { router, ctx, host, ownTerminals } = makeRouter({ host: { 'terminal.close': () => ({ closed: true }) } })
    ownTerminals.add('t2')
    ctx.store.upsertAgent('term:t2', 1, { terminalId: 't2' }, () => newAgent('term:t2', 'agent', 0))
    assert.deepEqual(await router.handle(command('agent.stop', { agentId: 'term:t2' }, { confirmed: true })), { ok: true, result: { closed: true } })
    assert.deepEqual(host.callsTo('terminal.close'), [{ terminalId: 't2' }])
  })

  it('agent.stop on an unknown agent is not_found', async () => {
    const { router } = makeRouter()
    assert.equal(errorOf(await router.handle(command('agent.stop', { agentId: 'ghost' }, { confirmed: true }))).error.code, 'not_found')
  })

  it('task.cancel stops live workers then needs the coordinator to mark it', async () => {
    const { router, ctx, cli } = makeRouter({ cli: { 'orchestration worker-stop': {} } })
    ctx.store.upsertAgent('dispatch:ctx_2', 1, { dispatchId: 'ctx_2', live: true }, () => newAgent('dispatch:ctx_2', 'worker', 0))
    ctx.store.upsertAgent('dispatch:ctx_1', 1, { dispatchId: 'ctx_1', live: false }, () => newAgent('dispatch:ctx_1', 'worker', 0))
    const response = errorOf(await router.handle(command('task.cancel', { taskId: 'task_1', runId: 'run_1' }, { confirmed: true })))
    assert.deepEqual(cli.callsTo('orchestration worker-stop'), [['orchestration', 'worker-stop', '--dispatch', 'ctx_2']])
    assert.equal(response.error.code, 'coordinator_required')
    assert.match(response.error.message, /^Stopped 1 worker\(s\)/)
    assert.equal(response.manual?.command, 'orca orchestration task-update --run=run_1 --id=task_1 --status=failed --result=cancelled')
  })

  it('worktree.inspect refuses paths Orca does not know', async () => {
    const { router } = makeRouter()
    const response = errorOf(await router.handle(command('worktree.inspect', { path: '/etc' })))
    assert.equal(response.error.code, 'not_permitted')
  })
})

describe('CommandRouter: agent.prompt', () => {
  function withAgent(router: ReturnType<typeof makeRouter>, id: string, partial: Parameters<typeof newAgent>[1] extends string ? Record<string, unknown> : never) {
    const agent = { ...newAgent(id, 'agent', 1), ...partial }
    router.ctx.store.upsertAgent(id, 1, agent, () => agent)
  }

  it('types into a terminal agent and submits', async () => {
    const r = makeRouter({ host: { 'terminal.sendText': () => ({ accepted: true }) } })
    withAgent(r, 'term:t1', { terminalId: 't1' })
    const response = await r.router.handle(command('agent.prompt', { agentId: 'term:t1', text: 'please run the tests' }))
    assert.deepEqual(response, { ok: true, result: { via: 'terminal', delivered: true } })
    assert.deepEqual(r.host.callsTo('terminal.sendText')[0], { terminalId: 't1', text: 'please run the tests', enter: true })
  })

  it('routes a terminal-less worker through an orchestration message (coordinator rules)', async () => {
    const r = makeRouter()
    r.ctx.store.put({ entity: 'run', id: 'run_1', value: { id: 'run_1', objective: 'o', legacy: false, coordinatorHandle: null, state: 'active', startedAt: null, endedAt: null, taskCount: 0, version: 1 } })
    withAgent(r, 'dispatch:ctx_1', { role: 'worker', dispatchId: 'ctx_1', runId: 'run_1' })
    const response = errorOf(await r.router.handle(command('agent.prompt', { agentId: 'dispatch:ctx_1', text: '--not-a-flag hello' })))
    assert.equal(response.error.code, 'coordinator_required')
    assert.match(response.manual?.command ?? '', /orchestration send --run=run_1 --to=dispatch:ctx_1/)
    assert.match(response.manual?.command ?? '', /'--body=--not-a-flag hello'/)
  })

  it('refuses chat sessions and subagents with a clear reason', async () => {
    const r = makeRouter({ host: { 'terminal.sendText': () => ({ accepted: true }) } })
    withAgent(r, 'session:s1', { sessionId: 's1' })
    withAgent(r, 'sub:1', { role: 'subagent' })
    assert.match(errorOf(await r.router.handle(command('agent.prompt', { agentId: 'session:s1', text: 'hi' }))).error.message, /chat session/)
    assert.match(errorOf(await r.router.handle(command('agent.prompt', { agentId: 'sub:1', text: 'hi' }))).error.message, /parent/)
    assert.equal(r.host.callsTo('terminal.sendText').length, 0)
  })
})

describe('CommandRouter: project labels', () => {
  it('stores project names, colors and rules, dropping colors that are not plain hex', async () => {
    const { router, labelUpdates } = makeRouter()
    const response = await router.handle(command('labels.update', { projectNames: { 'project:p1': 'Demo project' }, projectColors: { 'project:p1': '#10b981', 'project:p2': 'red;x:url(y)' }, projectRules: { '~/Code/acme/**': 'Acme' } }))
    assert.equal(response.ok, true)
    assert.deepEqual(labelUpdates[0].projectColors, { 'project:p1': '#10b981' })
    assert.deepEqual(labelUpdates[0].projectRules, { '~/Code/acme/**': 'Acme' })
  })
})
