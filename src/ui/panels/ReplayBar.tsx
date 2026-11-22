// Replay controls shown above the canvas while a saved run is replayed. Nothing is executed.
import { Button, clock } from '../components/primitives.tsx'
import { useApp, useFlowView } from '../state/app-context.tsx'

export function ReplayBar() {
  const { client, viewStore } = useApp()
  const flow = useFlowView()
  if (flow.mode !== 'replay' || !flow.replay) return null
  const { cursor, total, runId } = flow.replay
  const current = flow.events[flow.events.length - 1]
  return (
    <div className="af-replay-bar" role="region" aria-label="Replay">
      <b>Replay</b>
      <span className="af-muted">{flow.state.runs[runId]?.objective.slice(0, 60)}</span>
      <Button size="sm" onClick={() => client.seekReplay(0)}>Start</Button>
      <Button size="sm" onClick={() => client.seekReplay(cursor - 1)}>◀</Button>
      <input type="range" min={0} max={total} value={cursor} onChange={(e) => client.seekReplay(Number(e.target.value))} aria-label="Replay position" />
      <Button size="sm" onClick={() => client.seekReplay(cursor + 1)}>▶</Button>
      <span className="af-muted" style={{ whiteSpace: 'nowrap' }}>{cursor}/{total}{current ? ` · ${clock(current.ts)}` : ''}</span>
      <Button size="sm" variant="primary" onClick={() => { client.exitReplay(); viewStore.setFilters({ runId: 'all' }) }}>Back to live</Button>
    </div>
  )
}
