// Builds the exact `orca orchestration …` arguments for coordinator-only actions.
import type { CommandRequest } from '../../shared/commands.ts'
import type { FlowState } from '../../shared/model.ts'

/**
 * Orca's CLI parser treats any argv element starting with `--` as a new flag, so a value is
 * always passed in the same element as its flag (`--spec=…`). Free text that happens to start
 * with `--` can then never be read as another flag.
 */
export function flag(name: string, value: string): string {
  return `--${name}=${value}`
}

export function coordinatorArgs(request: CommandRequest, state: FlowState): string[] | null {
  const p = request.params as Record<string, unknown>
  const runId = typeof p.runId === 'string' ? p.runId : null
  if (!runId || !state.runs[runId]) return null
  const s = (key: string) => (typeof p[key] === 'string' ? (p[key] as string) : null)
  switch (request.kind) {
    case 'task.create': {
      const args = ['orchestration', 'task-create', flag('run', runId), flag('task-title', s('title') ?? 'Task'), flag('spec', s('spec') ?? '')]
      const deps = Array.isArray(p.deps) ? (p.deps as string[]) : []
      if (deps.length) args.push(flag('deps', JSON.stringify(deps)))
      if (s('parentId')) args.push(flag('parent', s('parentId')!))
      return args
    }
    case 'task.update': {
      const taskId = s('taskId')
      if (!taskId || state.tasks[taskId]?.runId !== runId) return null
      const args = ['orchestration', 'task-update', flag('run', runId), flag('id', taskId), flag('status', s('status') ?? 'pending')]
      if (s('result')) args.push(flag('result', s('result')!))
      return args
    }
    case 'task.retry':
    case 'task.dispatch': {
      const taskId = s('taskId')
      const task = taskId ? state.tasks[taskId] : undefined
      if (!task || task.runId !== runId) return null
      const args = ['orchestration', 'worker-start', flag('run', runId), flag('task', task.id)]
      if (request.kind === 'task.retry') {
        const last = task.dispatchIds[task.dispatchIds.length - 1]
        if (last) args.push(flag('retry-of', last))
      }
      if (s('agent')) args.push(flag('agent', s('agent')!))
      if (s('model')) args.push(flag('model', s('model')!))
      if (s('model') && s('effort')) args.push(flag('effort', s('effort')!))
      args.push(flag('worktree', s('worktree') ?? 'new-child'))
      return args
    }
    case 'gate.resolve': {
      const gateId = s('gateId')
      if (!gateId) return null
      // The gate must belong to a task of this run; otherwise a run's controls could resolve another run's gate.
      const taskId = state.gates[gateId]?.taskId
      if (!taskId || state.tasks[taskId]?.runId !== runId) return null
      return ['orchestration', 'gate-resolve', flag('id', gateId), flag('resolution', s('resolution') ?? '')]
    }
    case 'message.send':
      return [
        'orchestration', 'send', flag('run', runId), flag('to', s('to') ?? `run:${runId}`),
        flag('subject', s('subject') ?? ''), flag('body', s('body') ?? ''), flag('type', 'status')
      ]
    default:
      return null
  }
}

/** POSIX shell quoting for the copyable command shown to the person. */
export function shellQuote(arg: string): string {
  return /^[A-Za-z0-9_@%+=:,./-]+$/.test(arg) ? arg : `'${arg.replace(/'/g, `'\\''`)}'`
}
