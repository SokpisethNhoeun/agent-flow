// Two saved runs side by side: totals, then every task with what changed (regressions first).
import { Dialog } from '../components/overlays.tsx'
import { Button, Chip } from '../components/primitives.tsx'
import { compareRuns, runTotals, type ComparableRun, type RowChange } from '../graph/compare-runs.ts'
import { formatElapsed } from '../graph/run-summary.ts'
import { formatTokens } from '../graph/status.ts'

const CHANGE: Record<RowChange, { label: string; tone: 'muted' | 'accent' | 'warning' | 'danger' | 'success' }> = {
  broke: { label: 'Now failing', tone: 'danger' },
  fixed: { label: 'Fixed', tone: 'success' },
  changed: { label: 'Changed', tone: 'accent' },
  slower: { label: 'Slower', tone: 'warning' },
  faster: { label: 'Faster', tone: 'success' },
  added: { label: 'New', tone: 'accent' },
  removed: { label: 'Not in B', tone: 'muted' },
  same: { label: 'Same', tone: 'muted' }
}

export function CompareRunsDialog({ a, b, onClose }: { a: ComparableRun; b: ComparableRun; onClose: () => void }) {
  const rows = compareRuns(a, b)
  const ta = runTotals(a)
  const tb = runTotals(b)
  const changed = rows.filter((r) => r.change !== 'same').length
  const cell = (side: (typeof rows)[number]['a']) =>
    side ? (
      <>
        <span className="af-dot" data-status={side.state === 'DONE' || side.state === 'MERGED' || side.state === 'APPROVED' ? 'done' : side.state === 'FAILED' || side.state === 'CANCELLED' ? 'failed' : side.state === 'BLOCKED' ? 'blocked' : 'running'} /> {side.state.toLowerCase()}
        {side.durationMs != null ? <span className="af-muted"> · {formatElapsed(side.durationMs)}</span> : null}
        {side.retries ? <span className="af-muted"> · {side.retries} retr{side.retries === 1 ? 'y' : 'ies'}</span> : null}
      </>
    ) : (
      <span className="af-muted">—</span>
    )
  const total = (t: ReturnType<typeof runTotals>) => `${t.done}/${t.tasks} done${t.failed ? ` · ${t.failed} failed` : ''} · ${t.durationMs != null ? `${formatElapsed(t.durationMs)}${t.ongoing ? ' so far' : ''}` : 'time not recorded'} · ${formatTokens(t.tokens) ? `${formatTokens(t.tokens)} tokens` : 'tokens not reported'}`
  return (
    <Dialog title="Compare runs" onClose={onClose} wide footer={<Button variant="primary" onClick={onClose}>Close</Button>}>
      <div className="af-compare-head">
        <div><Chip tone="accent">A</Chip> <b title={a.run.objective}>{a.run.objective}</b><div className="af-muted">{total(ta)}</div></div>
        <div><Chip tone="accent">B</Chip> <b title={b.run.objective}>{b.run.objective}</b><div className="af-muted">{total(tb)}</div></div>
      </div>
      <div className="af-muted" style={{ fontSize: 12 }}>{rows.length} tasks matched by name · {changed} differ</div>
      <div className="af-compare-table" role="table" aria-label="Tasks in run A and run B">
        <div role="row" className="head">
          <span role="columnheader">Task</span>
          <span role="columnheader">A</span>
          <span role="columnheader">B</span>
          <span role="columnheader">Change</span>
        </div>
        {rows.map((row) => (
          <div role="row" key={row.name} className={row.change === 'same' ? 'same' : ''}>
            <span role="cell" title={row.name}>{row.name}</span>
            <span role="cell">{cell(row.a)}</span>
            <span role="cell">{cell(row.b)}</span>
            <span role="cell"><Chip tone={CHANGE[row.change].tone}>{CHANGE[row.change].label}</Chip></span>
          </div>
        ))}
      </div>
    </Dialog>
  )
}
