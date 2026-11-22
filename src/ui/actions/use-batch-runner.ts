// Runs a batch action: one confirmation, then each command in turn, then one summary toast.
import { useCallback, useState } from 'react'
import { newRequestId, type ManualStep } from '../../shared/commands.ts'
import { useApp } from '../state/app-context.tsx'
import { batchConfirm, type BatchAction } from './batch-actions.ts'

export function useBatchRunner(): { run: (action: BatchAction) => Promise<void>; busy: string | null } {
  const { client, toast, confirmAction, showManual } = useApp()
  const [busy, setBusy] = useState<string | null>(null)
  const run = useCallback(
    async (action: BatchAction) => {
      if (!action.commands.length || busy) return
      if (!(await confirmAction(batchConfirm(action)))) return
      setBusy(action.id)
      let done = 0
      const errors: string[] = []
      let manual: ManualStep | null = null
      try {
        // One at a time: Orca's CLI and coordinator handle these sequentially anyway.
        for (const command of action.commands) {
          const response = await client.transport.command({ requestId: newRequestId(), kind: command.kind, params: command.params, confirmed: true })
          if (response.ok) done++
          else {
            errors.push(response.error.message)
            manual ??= response.manual ?? null
          }
        }
      } finally {
        setBusy(null)
      }
      const total = action.commands.length
      if (!errors.length) toast(`${action.label}: ${done} of ${total} done`, 'done')
      else toast(`${action.label}: ${done} of ${total} done, ${errors.length} failed — ${errors[0]}`, 'failed')
      if (manual) showManual(manual)
    },
    [busy, client, confirmAction, showManual, toast]
  )
  return { run, busy }
}
