// Parts of the UI most visits never open load on demand, so the first paint parses less code.
// Each wrapper renders nothing until its chunk arrives (local files: a few milliseconds).
import { lazy, Suspense, type ComponentType } from 'react'

function lazyNamed<P extends object>(load: () => Promise<Record<string, unknown>>, name: string): ComponentType<P> {
  // Typed loosely inside; the exported wrapper carries the real props type.
  const Inner = lazy(async () => ({ default: (await load())[name] as ComponentType<Record<string, unknown>> }))
  function Lazy(props: P) {
    return (
      <Suspense fallback={null}>
        <Inner {...(props as Record<string, unknown>)} />
      </Suspense>
    )
  }
  Lazy.displayName = `Lazy(${name})`
  return Lazy
}

type Close = { onClose: () => void }
const dialogs = () => import('./dialogs/ActionDialogs.tsx')

export const RetryDialog = lazyNamed<Close & { taskId: string; runId: string; mode: 'retry' | 'dispatch' }>(dialogs, 'RetryDialog')
export const TaskDialog = lazyNamed<Close & { runId: string; deps: string[] }>(dialogs, 'TaskDialog')
export const LaunchDialog = lazyNamed<Close & { workspaceId: string }>(dialogs, 'LaunchDialog')
export const MessageDialog = lazyNamed<Close & { runId: string; to: string }>(dialogs, 'MessageDialog')
export const GateDialog = lazyNamed<Close & { gateId: string; runId: string }>(dialogs, 'GateDialog')
export const LabelsDialog = lazyNamed<Close>(dialogs, 'LabelsDialog')
export const ProjectsDialog = lazyNamed<Close>(() => import('./dialogs/ProjectsDialog.tsx'), 'ProjectsDialog')
export const GitPanel = lazyNamed<{ path: string }>(() => import('./panels/inspector/GitPanel.tsx'), 'GitPanel')
export const BottomPanel = lazyNamed<Record<string, never>>(() => import('./panels/BottomPanel.tsx'), 'BottomPanel')
