import { useCallback } from 'react'
import type { CommandKind } from '../../shared/commands.ts'
import { GateDialog, LaunchDialog, MessageDialog, RetryDialog, TaskDialog } from '../lazy.tsx'
import { useApp } from '../state/app-context.tsx'
import type { EntityAction } from './entity-actions.ts'

/** Runs an entity action: opens its form, or sends its command (with confirmation when destructive). */
export function useActionRunner(): (action: EntityAction) => void {
  const { runCommand, openDialog, viewStore } = useApp()
  return useCallback(
    (action: EntityAction) => {
      if (action.disabled) return
      const p = action.params as Record<string, string & string[]>
      switch (action.kind) {
        case 'ui.inspect':
          viewStore.set({ selectedId: p.id })
          return
        case 'ui.retryDialog':
          openDialog((close) => <RetryDialog taskId={p.taskId} runId={p.runId} mode={p.mode === 'dispatch' ? 'dispatch' : 'retry'} onClose={close} />)
          return
        case 'ui.taskDialog':
          openDialog((close) => <TaskDialog runId={p.runId} deps={p.deps ?? []} onClose={close} />)
          return
        case 'ui.launchDialog':
          openDialog((close) => <LaunchDialog workspaceId={p.workspaceId} onClose={close} />)
          return
        case 'ui.messageDialog':
          openDialog((close) => <MessageDialog runId={p.runId} to={p.to} onClose={close} />)
          return
        case 'ui.gateDialog':
          openDialog((close) => <GateDialog gateId={p.gateId} runId={p.runId} onClose={close} />)
          return
        default: {
          const confirm =
            action.kind === 'agent.stop'
              ? { title: 'Stop this worker?', message: 'Orca stops the worker’s agent terminal and its helpers. The worktree and its files are kept.', label: 'Stop worker', danger: true }
              : action.kind === 'task.cancel'
                ? { title: 'Cancel this task?', message: 'Agent Flow stops the task’s running worker, then marks the task cancelled. A later retry can reopen it.', label: 'Cancel task', danger: true }
                : undefined
          void runCommand(action.kind as CommandKind, action.params, confirm)
        }
      }
    },
    [runCommand, openDialog, viewStore]
  )
}
