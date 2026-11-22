import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { ALL_COMMANDS, COMMAND_PARAMS, isRecord, newRequestId, validateCommand, ValidationError } from '../src/shared/commands.ts'

const RID = 'req_12345678'

function rejects(input: unknown, message?: RegExp): void {
  assert.throws(() => validateCommand(input), (error: unknown) => {
    assert.ok(error instanceof ValidationError)
    assert.equal(error.code, 'invalid_params')
    if (message) assert.match(error.message, message)
    return true
  })
}

describe('validateCommand: envelope', () => {
  it('accepts a minimal valid command and defaults params/confirmed', () => {
    const request = validateCommand({ requestId: RID, kind: 'dashboard.info' })
    assert.deepEqual(request, { requestId: RID, kind: 'dashboard.info', params: {}, confirmed: false })
  })

  it('refuses non-objects', () => {
    rejects(null)
    rejects('x')
    rejects([RID])
  })

  it('refuses malformed requestIds', () => {
    rejects({ kind: 'dashboard.info' }, /requestId/)
    rejects({ requestId: 'short', kind: 'dashboard.info' }, /requestId/)
    rejects({ requestId: 'has spaces in it', kind: 'dashboard.info' }, /requestId/)
    rejects({ requestId: 'x'.repeat(81), kind: 'dashboard.info' }, /requestId/)
    rejects({ requestId: 12345678, kind: 'dashboard.info' }, /requestId/)
  })

  it('refuses unknown kinds', () => {
    rejects({ requestId: RID, kind: 'agent.delete' }, /Unknown command/)
    rejects({ requestId: RID }, /Unknown command/)
  })

  it('refuses non-boolean confirmed and keeps true', () => {
    rejects({ requestId: RID, kind: 'dashboard.info', confirmed: 'yes' }, /confirmed/)
    assert.equal(validateCommand({ requestId: RID, kind: 'dashboard.info', confirmed: true }).confirmed, true)
  })

  it('refuses non-object params', () => {
    rejects({ requestId: RID, kind: 'dashboard.info', params: [] }, /params/)
    rejects({ requestId: RID, kind: 'dashboard.info', params: 'x' }, /params/)
  })

  it('every command kind has a param spec', () => {
    for (const kind of ALL_COMMANDS) assert.ok(COMMAND_PARAMS[kind], kind)
  })
})

describe('validateCommand: fields', () => {
  it('refuses unknown fields (strict)', () => {
    rejects({ requestId: RID, kind: 'terminal.focus', params: { terminalId: 't1', extra: 1 } }, /Unknown field "extra"/)
    rejects({ requestId: RID, kind: 'dashboard.info', params: { anything: true } }, /Unknown field/)
  })

  it('refuses unknown fields named like Object.prototype members', () => {
    // `key in spec` sees inherited keys, so these slip past the strict check.
    rejects({ requestId: RID, kind: 'dashboard.info', params: { constructor: 'x' } }, /Unknown field/)
    rejects({ requestId: RID, kind: 'terminal.focus', params: JSON.parse('{"terminalId":"t1","toString":"x"}') }, /Unknown field/)
  })

  it('requires required fields; empty string and null count as missing', () => {
    rejects({ requestId: RID, kind: 'terminal.focus', params: {} }, /terminalId is required/)
    rejects({ requestId: RID, kind: 'terminal.focus', params: { terminalId: '' } }, /required/)
    rejects({ requestId: RID, kind: 'terminal.focus', params: { terminalId: null } }, /required/)
  })

  it('drops empty optional fields', () => {
    const request = validateCommand({ requestId: RID, kind: 'agent.launch', params: { workspaceId: 'ws1', agent: 'claude', prompt: '' } })
    assert.deepEqual(request.params, { workspaceId: 'ws1', agent: 'claude' })
  })

  it('checks types', () => {
    rejects({ requestId: RID, kind: 'terminal.focus', params: { terminalId: 42 } }, /must be a string/)
    rejects({ requestId: RID, kind: 'task.create', params: { runId: 'r', title: 't', spec: 's', deps: 'a' } }, /must be a list/)
    rejects({ requestId: RID, kind: 'labels.update', params: { accountTeams: [] } }, /must be an object/)
  })

  it('checks patterns', () => {
    rejects({ requestId: RID, kind: 'terminal.focus', params: { terminalId: 'a b' } }, /not allowed/)
    rejects({ requestId: RID, kind: 'terminal.focus', params: { terminalId: 'a;rm -rf' } }, /not allowed/)
    rejects({ requestId: RID, kind: 'agent.launch', params: { workspaceId: 'w', agent: 'Claude' } }, /not allowed/)
    rejects({ requestId: RID, kind: 'agent.launch', params: { workspaceId: 'w', agent: '-claude' } }, /not allowed/)
    rejects({ requestId: RID, kind: 'task.retry', params: { taskId: 't', runId: 'r', effort: 'HIGH' } }, /not allowed/)
    rejects({ requestId: RID, kind: 'task.retry', params: { taskId: 't', runId: 'r', model: 'bad model' } }, /not allowed/)
    const ok = validateCommand({ requestId: RID, kind: 'task.retry', params: { taskId: 'task_1', runId: 'run_1', model: 'claude-opus-5-5[1m]', effort: 'high', agent: 'claude' } })
    assert.equal(ok.params.model, 'claude-opus-5-5[1m]')
  })

  it('restricts worktree on task.retry and task.dispatch to new-child or current', () => {
    for (const kind of ['task.retry', 'task.dispatch']) {
      for (const worktree of ['new-child', 'current']) {
        assert.equal(validateCommand({ requestId: RID, kind, params: { taskId: 't', runId: 'r', worktree } }).params.worktree, worktree)
      }
      for (const worktree of ['/tmp/x', '--help', 'new-child --x', 'NEW-CHILD']) {
        rejects({ requestId: RID, kind, params: { taskId: 't', runId: 'r', worktree } }, /one of new-child, current/)
      }
    }
  })

  it('checks max lengths', () => {
    rejects({ requestId: RID, kind: 'task.create', params: { runId: 'r', title: 'x'.repeat(201), spec: 's' } }, /longer than 200/)
    validateCommand({ requestId: RID, kind: 'task.create', params: { runId: 'r', title: 'x'.repeat(200), spec: 's' } })
  })

  it('checks oneOf', () => {
    rejects({ requestId: RID, kind: 'task.update', params: { taskId: 't', runId: 'r', status: 'done' } }, /must be one of/)
    for (const status of ['pending', 'ready', 'dispatched', 'completed', 'failed', 'blocked']) {
      assert.equal(validateCommand({ requestId: RID, kind: 'task.update', params: { taskId: 't', runId: 'r', status } }).params.status, status)
    }
  })

  it('dedupes string arrays and validates items', () => {
    const request = validateCommand({ requestId: RID, kind: 'task.create', params: { runId: 'r', title: 't', spec: 's', deps: ['a', 'b', 'a'] } })
    assert.deepEqual(request.params.deps, ['a', 'b'])
    rejects({ requestId: RID, kind: 'task.create', params: { runId: 'r', title: 't', spec: 's', deps: ['ok', 3] } }, /invalid item/)
    rejects({ requestId: RID, kind: 'task.create', params: { runId: 'r', title: 't', spec: 's', deps: ['bad id'] } }, /invalid item/)
    rejects({ requestId: RID, kind: 'task.create', params: { runId: 'r', title: 't', spec: 's', deps: Array.from({ length: 51 }, (_, i) => `d${i}`) } }, /too many items/)
  })

  it('enforces record limits', () => {
    const ok = validateCommand({ requestId: RID, kind: 'labels.update', params: { accountTeams: { acc1: 'Team A' } } })
    assert.deepEqual(ok.params.accountTeams, { acc1: 'Team A' })
    const tooMany = Object.fromEntries(Array.from({ length: 101 }, (_, i) => [`k${i}`, 'v']))
    rejects({ requestId: RID, kind: 'labels.update', params: { accountTeams: tooMany } }, /too many entries/)
    rejects({ requestId: RID, kind: 'labels.update', params: { accountTeams: { a: 'x'.repeat(121) } } }, /short strings/)
    rejects({ requestId: RID, kind: 'labels.update', params: { accountTeams: { ['k'.repeat(301)]: 'v' } } }, /short strings/)
    rejects({ requestId: RID, kind: 'labels.update', params: { accountTeams: { a: 1 } } }, /short strings/)
  })
})

describe('helpers', () => {
  it('isRecord', () => {
    assert.equal(isRecord({}), true)
    assert.equal(isRecord([]), false)
    assert.equal(isRecord(null), false)
  })

  it('newRequestId is valid and unique', () => {
    const a = newRequestId()
    assert.notEqual(a, newRequestId())
    assert.equal(validateCommand({ requestId: a, kind: 'dashboard.info' }).requestId, a)
  })
})
