// Floating bar for several selected cards: batch stop, retry and cancel, and clear.
import { useMemo } from 'react'
import { batchActionsFor } from '../actions/batch-actions.ts'
import { useBatchRunner } from '../actions/use-batch-runner.ts'
import { Button } from '../components/primitives.tsx'
import { Tip } from '../components/ui/Controls.tsx'
import type { EntityRef } from '../graph/types.ts'
import { useApp, useFlowView } from '../state/app-context.tsx'

export function SelectionBar({ entities, onClear }: { entities: EntityRef[]; onClear: () => void }) {
  const { client } = useApp()
  const flow = useFlowView()
  const viewOnly = client.transport.kind === 'http' && flow.state.capabilities.dashboardControls !== true
  const actions = useMemo(() => batchActionsFor(entities, flow.state, viewOnly || flow.mode === 'replay'), [entities, flow.state, viewOnly, flow.mode])
  const { run, busy } = useBatchRunner()
  if (entities.length < 2) return null
  return (
    <div className="af-selection-bar" role="toolbar" aria-label={`${entities.length} selected`}>
      <b>
        {entities.length}
        <span className="af-sel-label"> selected</span>
      </b>
      {actions.map((action) => {
        const n = action.commands.length
        // Short verb on the button, full name and count in its accessible name and tooltip.
        const short = action.label.split(' ')[0]
        const button = (
          <Button size="sm" icon={action.icon} variant={action.danger && n ? 'danger' : undefined} disabled={!n || Boolean(busy)} onClick={() => void run(action)} aria-label={`${action.label} (${n})`}>
            <span className="af-sel-label">{busy === action.id ? `${short}…` : short}</span>
            {n ? <span className="af-count">{n}</span> : null}
          </Button>
        )
        return (
          <Tip key={action.id} content={n ? `${action.label}: ${n}` : action.reason}>
            <span tabIndex={n ? -1 : 0}>{button}</span>
          </Tip>
        )
      })}
      <Button size="sm" iconOnly variant="ghost" icon="close" onClick={onClear} title="Clear selection (Esc)" aria-label="Clear selection" />
    </div>
  )
}
