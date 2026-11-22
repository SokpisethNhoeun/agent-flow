// Compact totals for the selected run next to the run picker; the tooltip has the details.
import { useNow } from '../components/primitives.tsx'
import { Tip } from '../components/ui/Controls.tsx'
import { formatElapsed, summarizeRun, type RunSummary } from '../graph/run-summary.ts'
import { formatTokens } from '../graph/status.ts'
import { useFlowView } from '../state/app-context.tsx'

/** One line for the run picker's option hint. */
export function runHint(state: string, summary: RunSummary | null): string {
  if (!summary) return state
  const parts = [state]
  if (summary.total) parts.push(`${summary.done}/${summary.total} done`)
  if (summary.failed) parts.push(`${summary.failed} failed`)
  const elapsed = formatElapsed(summary.elapsedMs)
  if (elapsed) parts.push(elapsed)
  const tokens = formatTokens(summary.tokens)
  if (tokens) parts.push(`${summary.tokensPartial ? '≥' : ''}${tokens} tokens`)
  return parts.join(' · ')
}

export function RunSummaryChip({ runId }: { runId: string }) {
  const flow = useFlowView()
  const run = flow.state.runs[runId]
  const now = useNow(run?.state === 'active', 15000)
  const summary = summarizeRun(flow.state, runId, now)
  if (!summary || !run) return null
  const elapsed = formatElapsed(summary.elapsedMs)
  const tokens = formatTokens(summary.tokens)
  const pct = summary.total ? Math.round((summary.done / summary.total) * 100) : 0
  const details = (
    <div className="af-run-summary-tip">
      <div><b>{summary.done}</b> of {summary.total} tasks done{summary.running ? `, ${summary.running} running` : ''}{summary.failed ? `, ${summary.failed} failed` : ''}</div>
      <div>Time: {elapsed ?? 'not reported'}</div>
      <div>Tokens: {tokens ? `${tokens}${summary.tokensPartial ? ' (some agents did not report a count)' : ''}` : 'not reported by Orca'}</div>
      <div>{summary.agents} agents{summary.accounts.length ? ` · accounts: ${summary.accounts.join(', ')}` : ''}</div>
    </div>
  )
  return (
    <Tip content={details}>
      <span className="af-run-summary" tabIndex={0} aria-label={`Run progress: ${summary.done} of ${summary.total} tasks done`}>
        <span className="af-run-progress" aria-hidden>
          <span style={{ width: `${pct}%` }} />
          {summary.failed ? <span className="failed" style={{ width: `${summary.total ? (summary.failed / summary.total) * 100 : 0}%` }} /> : null}
        </span>
        <span>{summary.done}/{summary.total}</span>
        {elapsed ? <span className="af-muted">{elapsed}</span> : null}
        {tokens ? <span className="af-muted">{summary.tokensPartial ? '≥' : ''}{tokens}</span> : null}
      </span>
    </Tip>
  )
}
