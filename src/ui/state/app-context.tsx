// App-wide context: the live client, presentation store, and a command runner that handles
// confirmation for destructive actions, toasts with the real result, and coordinator commands.
import { createContext, useCallback, useContext, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { DESTRUCTIVE_COMMANDS, newRequestId, type CommandKind, type CommandResponse, type ManualStep } from '../../shared/commands.ts'
import { ConfirmDialog, Dialog, Toasts, type Toast } from '../components/overlays.tsx'
import { Button } from '../components/primitives.tsx'
import { TooltipProvider } from '../components/ui/Controls.tsx'
import type { FlowClient } from './flow-client.ts'
import type { ViewStore } from './view-store.ts'

export type Surface = 'panel' | 'canvas' | 'dashboard'

type Confirm = { title: string; message: ReactNode; label: string; danger?: boolean }

type AppContextValue = {
  client: FlowClient
  viewStore: ViewStore
  surface: Surface
  runCommand: (kind: CommandKind, params: Record<string, unknown>, confirm?: Confirm) => Promise<CommandResponse | null>
  toast: (text: string, tone?: Toast['tone']) => void
  openDialog: (render: (close: () => void) => ReactNode) => void
  /** Asks once; resolves true when the person confirmed. */
  confirmAction: (spec: Confirm) => Promise<boolean>
  /** Shows the coordinator command a command could not run directly. */
  showManual: (step: ManualStep) => void
}

const AppContext = createContext<AppContextValue | null>(null)

export function AppProvider({ client, viewStore, surface, children }: { client: FlowClient; viewStore: ViewStore; surface: Surface; children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const [confirm, setConfirm] = useState<(Confirm & { resolve: (ok: boolean) => void }) | null>(null)
  const [manual, setManual] = useState<ManualStep | null>(null)
  const [dialog, setDialog] = useState<ReactNode>(null)
  const counter = useRef(0)
  const inFlight = useRef(new Set<string>())

  const toast = useCallback((text: string, tone: Toast['tone'] = 'running') => {
    const id = ++counter.current
    setToasts((list) => [...list.slice(-4), { id, tone, text }])
    setTimeout(() => setToasts((list) => list.filter((t) => t.id !== id)), tone === 'failed' ? 9000 : 5000)
  }, [])

  const runCommand = useCallback(
    async (kind: CommandKind, params: Record<string, unknown>, confirmSpec?: Confirm) => {
      // Same action on the same target while one is running: ignore the double click.
      const key = `${kind}:${JSON.stringify(params)}`
      if (inFlight.current.has(key)) return null
      const needsConfirm = DESTRUCTIVE_COMMANDS.has(kind) || Boolean(confirmSpec)
      if (needsConfirm) {
        const spec = confirmSpec ?? { title: 'Confirm', message: 'Run this action?', label: 'Continue', danger: true }
        const ok = await new Promise<boolean>((resolve) => setConfirm({ ...spec, resolve }))
        setConfirm(null)
        if (!ok) return null
      }
      inFlight.current.add(key)
      try {
        const response = await client.transport.command({ requestId: newRequestId(), kind, params, confirmed: needsConfirm })
        if (response.ok) toast(`${labelFor(kind)}: done`, 'done')
        else if (response.manual) setManual(response.manual)
        else toast(`${labelFor(kind)}: ${response.error.message}`, 'failed')
        return response
      } finally {
        inFlight.current.delete(key)
      }
    },
    [client, toast]
  )

  const confirmAction = useCallback(async (spec: Confirm) => {
    const ok = await new Promise<boolean>((resolve) => setConfirm({ ...spec, resolve }))
    setConfirm(null)
    return ok
  }, [])

  const openDialog = useCallback((render: (close: () => void) => ReactNode) => {
    const close = () => setDialog(null)
    setDialog(render(close))
  }, [])

  const value = useMemo(() => ({ client, viewStore, surface, runCommand, toast, openDialog, confirmAction, showManual: setManual }), [client, viewStore, surface, runCommand, toast, openDialog, confirmAction])

  return (
    <AppContext.Provider value={value}>
      <TooltipProvider>
      {children}
      {dialog}
      {confirm ? (
        <ConfirmDialog title={confirm.title} message={confirm.message} confirmLabel={confirm.label} danger={confirm.danger} onConfirm={() => confirm.resolve(true)} onCancel={() => confirm.resolve(false)} />
      ) : null}
      {manual ? <ManualStepDialog step={manual} onClose={() => setManual(null)} onCopied={() => toast('Command copied', 'done')} /> : null}
      <Toasts toasts={toasts} onDismiss={(id) => setToasts((list) => list.filter((t) => t.id !== id))} />
      </TooltipProvider>
    </AppContext.Provider>
  )
}

function ManualStepDialog({ step, onClose, onCopied }: { step: ManualStep; onClose: () => void; onCopied: () => void }) {
  const copy = () => {
    const area = document.getElementById('af-manual-cmd') as HTMLTextAreaElement | null
    area?.select()
    // Clipboard reads/writes are refused in plugin frames; execCommand works inside a click.
    const done = document.execCommand?.('copy')
    if (done) onCopied()
  }
  return (
    <Dialog
      title="Run this in the Run’s coordinator"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Close</Button>
          <Button variant="primary" icon="copy" onClick={copy}>
            Copy command
          </Button>
        </>
      }
    >
      <div className="af-note warn">{step.reason}</div>
      <textarea id="af-manual-cmd" className="af-textarea" readOnly rows={5} value={step.command} onFocus={(e) => e.currentTarget.select()} />
    </Dialog>
  )
}

export function useApp(): AppContextValue {
  const value = useContext(AppContext)
  if (!value) throw new Error('AppProvider missing')
  return value
}

export function useFlowView() {
  const { client } = useApp()
  return useSyncExternalStore(client.subscribe, client.getView)
}

export function useViewState() {
  const { viewStore } = useApp()
  return useSyncExternalStore(viewStore.subscribe, viewStore.get)
}

const LABELS: Partial<Record<CommandKind, string>> = {
  'terminal.focus': 'Open terminal',
  'agent.launch': 'Launch agent',
  'agent.resume': 'Resume session',
  'agent.stop': 'Stop agent',
  'task.create': 'Create task',
  'task.update': 'Update task',
  'task.cancel': 'Cancel task',
  'task.retry': 'Retry task',
  'task.dispatch': 'Dispatch task',
  'gate.resolve': 'Resolve gate',
  'worktree.create': 'Create worktree',
  'worktree.open': 'Open worktree',
  'message.send': 'Send message',
  'labels.update': 'Save labels'
}

export function labelFor(kind: CommandKind): string {
  return LABELS[kind] ?? kind
}
