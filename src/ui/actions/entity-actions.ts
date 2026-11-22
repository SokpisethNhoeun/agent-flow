// Actions for a selected entity, shared by the context menu and the inspector. Each action is
// enabled only when the worker reported the backing command as available.
import type { CommandKind } from '../../shared/commands.ts'
import type { AgentRecord, FlowState, TaskRecord } from '../../shared/model.ts'
import type { IconName } from '../components/Icon.tsx'
import type { EntityRef } from '../graph/types.ts'

export type EntityAction = {
  id: string
  label: string
  icon: IconName
  kind: CommandKind | 'ui.inspect' | 'ui.retryDialog' | 'ui.taskDialog' | 'ui.launchDialog' | 'ui.messageDialog' | 'ui.gateDialog'
  params: Record<string, unknown>
  disabled: boolean
  reason: string | null
  danger?: boolean
  /** Coordinator-only: runs as coordinator when enabled, otherwise shows the command. */
  viaCoordinator?: boolean
}

export function actionsFor(entity: EntityRef, state: FlowState, viewOnly = false): EntityAction[] {
  const all = actionsForEntity(entity, state)
  if (!viewOnly) return all
  return all.map((a) => ({ ...a, disabled: true, reason: 'View-only browser dashboard: use the Agent Flow panel in Orca, or turn on “Allow controls from the browser dashboard” in Agent Flow settings.' }))
}

function actionsForEntity(entity: EntityRef, state: FlowState): EntityAction[] {
  const caps = state.capabilities.commands
  const make = (id: string, label: string, icon: IconName, kind: EntityAction['kind'], params: Record<string, unknown>, extra: Partial<EntityAction> = {}): EntityAction => {
    const cap = kind.startsWith('ui.') ? null : caps[kind]
    const available = cap ? cap.available : true
    return { id, label, icon, kind, params, disabled: !available || Boolean(extra.disabled), reason: extra.reason ?? cap?.reason ?? null, viaCoordinator: cap?.mode === 'coordinator', danger: extra.danger }
  }
  if (entity.type === 'agent') {
    const agent = state.agents[entity.id]
    if (!agent) return []
    return agentActions(agent, state, make)
  }
  if (entity.type === 'task') {
    const task = state.tasks[entity.id]
    if (!task) return []
    return taskActions(task, state, make)
  }
  if (entity.type === 'worktree') {
    const worktree = state.worktrees[entity.id] ?? Object.values(state.worktrees).find((w) => w.path === entity.id)
    if (!worktree) return []
    return [
      make('open', 'Open worktree in Orca', 'external', 'worktree.open', { workspaceId: worktree.id }),
      make('launch', 'Launch agent here…', 'play', 'ui.launchDialog', { workspaceId: worktree.id }, { disabled: !caps['agent.launch']?.available, reason: caps['agent.launch']?.reason ?? null })
    ]
  }
  if (entity.type === 'gate') {
    const gate = state.gates[entity.id]
    const task = gate?.taskId ? state.tasks[gate.taskId] : undefined
    if (!gate || !task) return []
    return [make('resolve', 'Resolve decision…', 'task', 'ui.gateDialog', { gateId: gate.id, runId: task.runId }, { disabled: !caps['gate.resolve']?.available, reason: caps['gate.resolve']?.reason ?? null })]
  }
  return []
}

type Make = (id: string, label: string, icon: IconName, kind: EntityAction['kind'], params: Record<string, unknown>, extra?: Partial<EntityAction>) => EntityAction

function agentActions(agent: AgentRecord, state: FlowState, make: Make): EntityAction[] {
  const list: EntityAction[] = []
  if (agent.terminalId) list.push(make('focus', 'Open terminal', 'terminal', 'terminal.focus', { terminalId: agent.terminalId }))
  else list.push(make('focus', 'Open terminal', 'terminal', 'terminal.focus', {}, { disabled: true, reason: 'Orca did not report a terminal for this agent (it may be a chat-only worker).' }))
  if (agent.role === 'worker' && agent.dispatchId) {
    list.push(make('stop', 'Stop worker', 'stop', 'agent.stop', { agentId: agent.id }, { danger: true, disabled: !agent.live, reason: agent.live ? null : 'This worker is not running.' }))
  } else if (agent.role === 'agent') {
    list.push(make('stop', 'Stop agent', 'stop', 'agent.stop', { agentId: agent.id }, { danger: true, disabled: true, reason: 'Orca lets plugins stop orchestration workers and terminals Agent Flow opened. Stop this agent from its own tab.' }))
  }
  if (agent.sessionId && agent.agent && agent.workspaceId && !agent.live && agent.role !== 'subagent') {
    list.push(make('resume', 'Resume session', 'play', 'agent.resume', { workspaceId: agent.workspaceId, agent: agent.agent, sessionId: agent.sessionId }))
  }
  if (agent.taskId) {
    const task = state.tasks[agent.taskId]
    if (task) list.push(make('retry', 'Retry task…', 'retry', 'ui.retryDialog', { taskId: task.id, runId: task.runId }, { disabled: !['FAILED', 'CANCELLED', 'BLOCKED', 'DONE'].includes(task.state), reason: ['FAILED', 'CANCELLED', 'BLOCKED', 'DONE'].includes(task.state) ? state.capabilities.commands['task.retry']?.reason ?? null : 'Only finished, failed or blocked tasks can be retried.' }))
  }
  if (agent.runId && agent.terminalHandle) list.push(make('message', 'Send message…', 'message', 'ui.messageDialog', { runId: agent.runId, to: agent.dispatchId ? `dispatch:${agent.dispatchId}` : `run:${agent.runId}` }))
  list.push(make('model', 'Change model / effort', 'cpu', 'model.change', { agentId: agent.id }))
  return list
}

function taskActions(task: TaskRecord, state: FlowState, make: Make): EntityAction[] {
  const live = task.dispatchIds.some((id) => state.agents[`dispatch:${id}`]?.live)
  const retryable = ['FAILED', 'CANCELLED', 'BLOCKED', 'DONE'].includes(task.state)
  const dispatchable = ['READY', 'PENDING'].includes(task.state) && !task.dispatchIds.length
  return [
    make('dispatch', 'Dispatch to an agent…', 'play', 'ui.retryDialog', { taskId: task.id, runId: task.runId, mode: 'dispatch' }, { disabled: !dispatchable, reason: dispatchable ? state.capabilities.commands['task.dispatch']?.reason ?? null : 'Only ready tasks without a worker can be dispatched.' }),
    make('retry', 'Retry…', 'retry', 'ui.retryDialog', { taskId: task.id, runId: task.runId, mode: 'retry' }, { disabled: !retryable, reason: retryable ? state.capabilities.commands['task.retry']?.reason ?? null : 'Only finished, failed or blocked tasks can be retried.' }),
    make('cancel', 'Cancel task', 'stop', 'task.cancel', { taskId: task.id, runId: task.runId }, { danger: true, disabled: ['DONE', 'MERGED', 'CANCELLED'].includes(task.state), reason: live ? 'Stops its worker, then marks it cancelled (coordinator).' : null }),
    make('subtask', 'Add dependent task…', 'plus', 'ui.taskDialog', { runId: task.runId, deps: [task.id] }, { disabled: !state.capabilities.commands['task.create']?.available, reason: state.capabilities.commands['task.create']?.reason ?? null })
  ]
}
