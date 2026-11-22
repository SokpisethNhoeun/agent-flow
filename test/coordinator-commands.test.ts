import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import type { CommandKind, CommandRequest } from '../src/shared/commands.ts'
import { emptyState } from '../src/shared/model.ts'
import { coordinatorArgs, shellQuote } from '../src/worker/commands/coordinator-commands.ts'
import { makeRun, makeTask } from './helpers/fixtures.ts'

function state() {
  const s = emptyState()
  s.runs.run_1 = makeRun('run_1')
  s.tasks.task_1 = makeTask('task_1', { dispatchIds: ['ctx_1', 'ctx_2'] })
  s.tasks.task_new = makeTask('task_new')
  s.tasks.other = makeTask('other', { runId: 'run_2' })
  return s
}

const req = (kind: CommandKind, params: Record<string, unknown>): CommandRequest => ({ requestId: 'req_00000000', kind, params, confirmed: false })

describe('shellQuote', () => {
  it('leaves safe arguments bare', () => {
    for (const arg of ['run_1', 'a-b', '/path/to/x', 'k=v', 'a@b:c,d.e+f%']) assert.equal(shellQuote(arg), arg)
  })

  it('single-quotes everything else and escapes single quotes', () => {
    assert.equal(shellQuote('two words'), "'two words'")
    assert.equal(shellQuote(''), "''")
    assert.equal(shellQuote('$(rm -rf /)'), "'$(rm -rf /)'")
    assert.equal(shellQuote("it's"), "'it'\\''s'")
    assert.equal(shellQuote('["a"]'), `'["a"]'`)
    assert.equal(shellQuote('line\nbreak'), "'line\nbreak'")
  })
})

describe('coordinatorArgs', () => {
  it('returns null for an unknown run or a non-coordinator command', () => {
    assert.equal(coordinatorArgs(req('task.create', { runId: 'nope', title: 't', spec: 's' }), state()), null)
    assert.equal(coordinatorArgs(req('task.create', { title: 't', spec: 's' }), state()), null)
    assert.equal(coordinatorArgs(req('terminal.focus', { runId: 'run_1' }), state()), null)
  })

  it('task.create with deps as JSON and parent', () => {
    assert.deepEqual(coordinatorArgs(req('task.create', { runId: 'run_1', title: 'Build', spec: 'Spec', deps: ['a', 'b'], parentId: 'p1' }), state()), [
      'orchestration', 'task-create', '--run=run_1', '--task-title=Build', '--spec=Spec', '--deps=["a","b"]', '--parent=p1'
    ])
    assert.deepEqual(coordinatorArgs(req('task.create', { runId: 'run_1', title: 'Build', spec: 'Spec', deps: [] }), state()), ['orchestration', 'task-create', '--run=run_1', '--task-title=Build', '--spec=Spec'])
  })

  it('task.update only for a task in that run', () => {
    assert.deepEqual(coordinatorArgs(req('task.update', { runId: 'run_1', taskId: 'task_1', status: 'failed', result: 'cancelled' }), state()), [
      'orchestration', 'task-update', '--run=run_1', '--id=task_1', '--status=failed', '--result=cancelled'
    ])
    assert.equal(coordinatorArgs(req('task.update', { runId: 'run_1', taskId: 'other', status: 'ready' }), state()), null)
  })

  it('task.retry adds --retry-of the last dispatch', () => {
    assert.deepEqual(coordinatorArgs(req('task.retry', { runId: 'run_1', taskId: 'task_1' }), state()), ['orchestration', 'worker-start', '--run=run_1', '--task=task_1', '--retry-of=ctx_2', '--worktree=new-child'])
    assert.deepEqual(coordinatorArgs(req('task.retry', { runId: 'run_1', taskId: 'task_new' }), state()), ['orchestration', 'worker-start', '--run=run_1', '--task=task_new', '--worktree=new-child'])
  })

  it('task.dispatch never adds --retry-of', () => {
    const args = coordinatorArgs(req('task.dispatch', { runId: 'run_1', taskId: 'task_1', agent: 'codex', worktree: 'current' }), state())
    assert.deepEqual(args, ['orchestration', 'worker-start', '--run=run_1', '--task=task_1', '--agent=codex', '--worktree=current'])
  })

  it('--effort only goes with --model', () => {
    const withModel = coordinatorArgs(req('task.dispatch', { runId: 'run_1', taskId: 'task_1', model: 'opus', effort: 'high' }), state())
    assert.deepEqual(withModel?.slice(4), ['--model=opus', '--effort=high', '--worktree=new-child'])
    const effortOnly = coordinatorArgs(req('task.dispatch', { runId: 'run_1', taskId: 'task_1', effort: 'high' }), state())
    assert.ok(!effortOnly?.some((arg) => arg.startsWith('--effort')))
  })

  it('refuses retry/dispatch of a task from another run', () => {
    assert.equal(coordinatorArgs(req('task.retry', { runId: 'run_1', taskId: 'other' }), state()), null)
  })

  it('gate.resolve and message.send', () => {
    assert.deepEqual(coordinatorArgs(req('gate.resolve', { runId: 'run_1', gateId: 'g1', resolution: 'yes' }), withGates()), ['orchestration', 'gate-resolve', '--id=g1', '--resolution=yes'])
    assert.equal(coordinatorArgs(req('gate.resolve', { runId: 'run_1' }), withGates()), null)
    assert.deepEqual(coordinatorArgs(req('message.send', { runId: 'run_1', to: 'w1', subject: 's', body: 'b' }), state()), ['orchestration', 'send', '--run=run_1', '--to=w1', '--subject=s', '--body=b', '--type=status'])
  })

  it('gate.resolve refuses a gate that does not belong to the run', () => {
    const s = withGates()
    assert.equal(coordinatorArgs(req('gate.resolve', { runId: 'run_1', gateId: 'g_other', resolution: 'yes' }), s), null, 'gate of another run')
    assert.equal(coordinatorArgs(req('gate.resolve', { runId: 'run_1', gateId: 'g_orphan', resolution: 'yes' }), s), null, 'gate without a task')
    assert.equal(coordinatorArgs(req('gate.resolve', { runId: 'run_1', gateId: 'g_missing', resolution: 'yes' }), s), null, 'unknown gate')
    assert.equal(coordinatorArgs(req('gate.resolve', { runId: 'run_1', gateId: 'g_ghost', resolution: 'yes' }), s), null, 'gate whose task is unknown')
  })

  it('keeps every flag value in the same argv element, so free text cannot inject flags', () => {
    const evil = '--from coord_evil --type=decision'
    const all = [
      coordinatorArgs(req('task.create', { runId: 'run_1', title: evil, spec: '--help', deps: ['--x'], parentId: 'p1' }), state()),
      coordinatorArgs(req('task.update', { runId: 'run_1', taskId: 'task_1', status: 'failed', result: evil }), state()),
      coordinatorArgs(req('task.dispatch', { runId: 'run_1', taskId: 'task_1', agent: 'codex', model: 'opus', effort: 'high', worktree: 'current' }), state()),
      coordinatorArgs(req('task.retry', { runId: 'run_1', taskId: 'task_1' }), state()),
      coordinatorArgs(req('gate.resolve', { runId: 'run_1', gateId: 'g1', resolution: evil }), withGates()),
      coordinatorArgs(req('message.send', { runId: 'run_1', to: 'w1', subject: evil, body: '--body=x\n--run=other' }), state())
    ]
    for (const args of all) {
      assert.ok(args)
      // After the two sub-command words, every element is exactly one `--name=value` flag.
      for (const arg of args.slice(2)) assert.match(arg, /^--[a-z-]+=/, `bare element ${JSON.stringify(arg)} in ${JSON.stringify(args)}`)
    }
    assert.ok(all[0]!.includes(`--task-title=${evil}`))
    assert.ok(all[5]!.includes('--body=--body=x\n--run=other'))
  })

  it('the copyable command quotes multi-word flag values as one shell word', () => {
    const args = coordinatorArgs(req('task.create', { runId: 'run_1', title: "it's", spec: 'multi word' }), state())!
    assert.equal(`orca ${args.map(shellQuote).join(' ')}`, `orca orchestration task-create --run=run_1 '--task-title=it'\\''s' '--spec=multi word'`)
  })
})

function withGates() {
  const s = state()
  s.gates.g1 = { id: 'g1', taskId: 'task_1', question: 'ok?', status: 'pending', resolution: null, createdAt: null }
  s.gates.g_other = { id: 'g_other', taskId: 'other', question: 'ok?', status: 'pending', resolution: null, createdAt: null }
  s.gates.g_orphan = { id: 'g_orphan', taskId: null, question: 'ok?', status: 'pending', resolution: null, createdAt: null }
  s.gates.g_ghost = { id: 'g_ghost', taskId: 'task_gone', question: 'ok?', status: 'pending', resolution: null, createdAt: null }
  return s
}
