// Actions over several selected cards at once: stop workers, retry tasks, cancel tasks.
// Each target is checked with the same rules as its own menu; ineligible ones are skipped and counted.
import type { CommandKind } from '../../shared/commands.ts'
import type { FlowState } from '../../shared/model.ts'
import type { IconName } from '../components/Icon.tsx'
import type { EntityRef } from '../graph/types.ts'
import { actionsFor } from './entity-actions.ts'

export type BatchCommand = { kind: CommandKind; params: Record<string, unknown> }

export type BatchAction = {
  id: 'stop' | 'retry' | 'cancel'
  label: string
  icon: IconName
  danger: boolean
  commands: BatchCommand[]
  /** Why nothing in the selection qualifies (shown when commands is empty). */
  reason: string | null
}

const RETRYABLE = ['FAILED', 'CANCELLED', 'BLOCKED', 'DONE']

export function batchActionsFor(entities: EntityRef[], state: FlowState, viewOnly: boolean): BatchAction[] {
  const stop = new Map<string, BatchCommand>()
  const retry = new Map<string, BatchCommand>()
  const cancel = new Map<string, BatchCommand>()
  const viewOnlyReason = viewOnly ? 'View-only browser dashboard.' : null
  for (const entity of entities) {
    const actions = actionsFor(entity, state, viewOnly)
    const stopAction = actions.find((a) => a.id === 'stop' && a.kind === 'agent.stop' && !a.disabled)
    if (stopAction) stop.set(String(stopAction.params.agentId), { kind: 'agent.stop', params: stopAction.params })
    const cancelAction = actions.find((a) => a.id === 'cancel' && a.kind === 'task.cancel' && !a.disabled)
    if (cancelAction) cancel.set(String(cancelAction.params.taskId), { kind: 'task.cancel', params: cancelAction.params })
    // Retry from a task card or from the worker card that ran it; the same task only once.
    const taskId = entity.type === 'task' ? entity.id : entity.type === 'agent' ? state.agents[entity.id]?.taskId : null
    const task = taskId ? state.tasks[taskId] : undefined
    const retryCap = state.capabilities.commands['task.retry']
    if (task && RETRYABLE.includes(task.state) && retryCap?.available && !viewOnly) retry.set(task.id, { kind: 'task.retry', params: { taskId: task.id, runId: task.runId } })
  }
  const list = (map: Map<string, BatchCommand>) => [...map.values()]
  return [
    { id: 'stop', label: 'Stop workers', icon: 'stop', danger: true, commands: list(stop), reason: viewOnlyReason ?? 'No running orchestration workers in the selection.' },
    { id: 'retry', label: 'Retry tasks', icon: 'retry', danger: false, commands: list(retry), reason: viewOnlyReason ?? state.capabilities.commands['task.retry']?.reason ?? 'No failed, blocked or finished tasks in the selection.' },
    { id: 'cancel', label: 'Cancel tasks', icon: 'stop', danger: true, commands: list(cancel), reason: viewOnlyReason ?? 'No open tasks in the selection.' }
  ]
}

export function batchConfirm(action: BatchAction): { title: string; message: string; label: string; danger: boolean } {
  const n = action.commands.length
  if (action.id === 'stop') return { title: `Stop ${n} worker${n === 1 ? '' : 's'}?`, message: 'Orca stops each worker’s agent terminal and its helpers. Worktrees and files are kept.', label: `Stop ${n}`, danger: true }
  if (action.id === 'cancel') return { title: `Cancel ${n} task${n === 1 ? '' : 's'}?`, message: 'Each task’s running worker is stopped, then the task is marked cancelled. A later retry can reopen it.', label: `Cancel ${n}`, danger: true }
  return { title: `Retry ${n} task${n === 1 ? '' : 's'}?`, message: 'Each task is dispatched again with its previous agent settings. This starts new agent sessions and uses tokens.', label: `Retry ${n}`, danger: false }
}
