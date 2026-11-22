// Bottom panel: live timeline, agent messages, errors, and run history with replay/export.
import { useEffect, useMemo, useState } from 'react'
import { newRequestId } from '../../shared/commands.ts'
import type { FlowEvent } from '../../shared/events.ts'
import { Button, Chip, clock, EmptyState, Tabs, timeAgo } from '../components/primitives.tsx'
import type { ReplayRecord } from '../state/flow-client.ts'
import { useApp, useFlowView, useViewState } from '../state/app-context.tsx'
import { ScrollArea } from '../components/ui/ScrollArea.tsx'
import { CompareRunsDialog } from '../dialogs/CompareRunsDialog.tsx'

const ROW_LIMIT = 400
const ERROR_KINDS = new Set(['agent.failed', 'task.failed', 'task.blocked', 'command.failed'])

export function BottomPanel() {
  const { viewStore } = useApp()
  const { events, state } = useFlowView()
  const view = useViewState()
  const errors = useMemo(() => events.filter((event) => ERROR_KINDS.has(event.kind)), [events])
  return (
    <>
      <Tabs
        value={view.bottomTab}
        onChange={(bottomTab) => viewStore.set({ bottomTab })}
        tabs={[
          { id: 'timeline', label: 'Timeline' },
          { id: 'messages', label: 'Messages', badge: state.messages.length || undefined },
          { id: 'errors', label: 'Errors', badge: errors.length || undefined },
          { id: 'history', label: 'History' }
        ]}
      />
      <ScrollArea className="af-scroll">
        {view.bottomTab === 'timeline' ? <Timeline events={events} /> : null}
        {view.bottomTab === 'messages' ? <Messages /> : null}
        {view.bottomTab === 'errors' ? (errors.length ? <Timeline events={errors} /> : <EmptyState icon="alert" title="No failures or blockers" />) : null}
        {view.bottomTab === 'history' ? <History /> : null}
      </ScrollArea>
    </>
  )
}

function Timeline({ events }: { events: FlowEvent[] }) {
  const { viewStore } = useApp()
  const view = useViewState()
  const filtered = view.filters.runId === 'all' ? events : events.filter((e) => e.runId === view.filters.runId || !e.runId)
  // Newest first by when it happened, not when Agent Flow learned about it.
  const rows = [...filtered].sort((a, b) => b.ts - a.ts || b.seq - a.seq).slice(0, ROW_LIMIT)
  if (!rows.length) return <EmptyState icon="history" title="No events yet">Status changes, task updates, handoffs and subagent spawns appear here as Orca reports them.</EmptyState>
  return (
    <div role="list">
      {rows.map((event) => (
        <div key={event.id} role="listitem" className="af-timeline-row" onClick={() => viewStore.set({ selectedId: event.entityId })} title={`${event.summary}\nsource: ${event.source}`}>
          <span className="af-muted">{clock(event.ts)}</span>
          <span className="af-dot" data-status={statusOf(event.kind)} />
          <span className="kind">{event.kind}</span>
          <span className="sum">{event.summary}</span>
        </div>
      ))}
    </div>
  )
}

function Messages() {
  const { state } = useFlowView()
  const view = useViewState()
  const messages = state.messages.filter((m) => view.filters.runId === 'all' || m.runId === view.filters.runId).slice(-200).reverse()
  if (!messages.length) return <EmptyState icon="message" title="No agent messages">Orchestration messages between the lead and workers (handoffs, worker_done, questions) appear here.</EmptyState>
  const name = (id: string | null, handle: string | null) => (id ? state.agents[id]?.title ?? id : handle ?? 'unknown')
  return (
    <div>
      {messages.map((m) => (
        <div key={m.id} className="af-section" style={{ fontSize: 12 }}>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <Chip tone={m.type === 'worker_done' ? 'success' : m.type === 'escalation' || m.type === 'question' ? 'warning' : 'accent'}>{m.type}</Chip>
            <b>{name(m.fromAgentId, m.fromHandle)}</b> → <b>{name(m.toAgentId, m.toHandle)}</b>
            <span className="af-muted" style={{ marginLeft: 'auto' }}>{timeAgo(m.createdAt)}</span>
          </div>
          {m.subject ? <div style={{ marginTop: 4 }}>{m.subject}</div> : null}
          {m.body ? <div className="af-muted" style={{ marginTop: 2, whiteSpace: 'pre-wrap', maxHeight: 80, overflow: 'hidden' }}>{m.body}</div> : null}
        </div>
      ))}
    </div>
  )
}

type Summary = { id: string; objective: string; state: string; startedAt: number | null; endedAt: number | null; taskCount: number; savedAt: number }

function History() {
  const { client, toast, viewStore, openDialog } = useApp()
  const flow = useFlowView()
  const [runs, setRuns] = useState<Summary[] | null>(null)
  /** Up to two runs picked for comparison, in the order picked (first is A). */
  const [picked, setPicked] = useState<string[]>([])
  const togglePick = (id: string) => setPicked((list) => (list.includes(id) ? list.filter((x) => x !== id) : [...list.slice(-1), id]))
  const compare = async () => {
    if (picked.length !== 2) return
    const [a, b] = await Promise.all(picked.map(load))
    if (a && b) openDialog((close) => <CompareRunsDialog a={a} b={b} onClose={close} />)
  }
  useEffect(() => {
    void client.transport.command({ requestId: newRequestId(), kind: 'history.list', params: {} }).then((response) => setRuns(response.ok ? (response.result as Summary[]) : []))
  }, [client])

  const load = async (runId: string): Promise<ReplayRecord | null> => {
    const response = await client.transport.command({ requestId: newRequestId(), kind: 'history.load', params: { runId } })
    if (!response.ok) {
      toast(response.error.message, 'failed')
      return null
    }
    return response.result as ReplayRecord
  }

  const exportRun = async (runId: string) => {
    const record = await load(runId)
    if (!record) return
    const summary = summarize(record)
    const blob = new Blob([summary], { type: 'text/markdown' })
    const name = `agent-flow-${runId}.md`
    const frame = (globalThis as { orca?: { files?: { saveAs(o: { suggestedName: string; mimeType: string; data: string }): Promise<unknown> } } }).orca
    if (frame?.files) await frame.files.saveAs({ suggestedName: name, mimeType: 'text/markdown', data: summary })
    else {
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = name
      a.click()
      URL.revokeObjectURL(a.href)
    }
  }

  if (!runs) return <div className="af-empty">Loading history…</div>
  if (!runs.length) return <EmptyState icon="history" title="No saved runs yet">Agent Flow saves each orchestration run as it changes, so finished runs can be replayed later.</EmptyState>
  return (
    <div>
      <div className="af-section af-compare-bar">
        <span className="af-muted">{picked.length === 0 ? 'Pick two runs to compare them.' : picked.length === 1 ? 'Pick one more run.' : '2 runs picked.'}</span>
        <Button size="sm" variant={picked.length === 2 ? 'primary' : undefined} disabled={picked.length !== 2} onClick={() => void compare()}>Compare</Button>
        {picked.length ? <Button size="sm" variant="ghost" onClick={() => setPicked([])}>Clear</Button> : null}
      </div>
      {runs.map((run) => (
        <div key={run.id} className="af-section" style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12 }}>
          <label className="af-compare-pick" title="Pick for comparison">
            <input type="checkbox" checked={picked.includes(run.id)} onChange={() => togglePick(run.id)} aria-label={`Compare: ${run.objective}`} />
            {picked.includes(run.id) ? <b>{picked.indexOf(run.id) === 0 ? 'A' : 'B'}</b> : null}
          </label>
          <span className="af-dot" data-status={run.state === 'completed' ? 'done' : run.state === 'failed' ? 'failed' : run.state === 'active' ? 'running' : 'idle'} />
          <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={run.objective}>{run.objective}</span>
          <span className="af-muted">{run.taskCount} tasks · {run.startedAt ? new Date(run.startedAt).toLocaleDateString() : '—'}</span>
          <Button size="sm" icon="play" disabled={flow.mode === 'replay' && flow.replay?.runId === run.id} onClick={async () => { const r = await load(run.id); if (r) { client.enterReplay(r); viewStore.setFilters({ runId: run.id }) } }}>Replay</Button>
          <Button size="sm" icon="download" onClick={() => void exportRun(run.id)}>Export</Button>
        </div>
      ))}
    </div>
  )
}

function statusOf(kind: string): string {
  if (kind.endsWith('failed')) return 'failed'
  if (kind.endsWith('blocked')) return 'blocked'
  if (kind.endsWith('completed') || kind === 'command.executed') return 'done'
  if (kind.startsWith('review') || kind.startsWith('test')) return 'review'
  if (kind === 'message.sent' || kind.endsWith('spawned') || kind.endsWith('started') || kind.endsWith('assigned')) return 'running'
  return 'ready'
}

function summarize(record: ReplayRecord): string {
  const lines = [`# ${record.run.objective}`, '', `Run \`${record.run.id}\` · ${record.run.state} · saved ${new Date(record.savedAt).toLocaleString()}`, '', '## Tasks', '']
  for (const task of record.tasks) lines.push(`- **${task.displayName ?? task.title}** — ${task.state}${task.result?.outcome ? ` (${task.result.outcome})` : ''}${task.retryCount ? `, ${task.retryCount} retries` : ''}`)
  lines.push('', '## Agents', '')
  for (const agent of record.agents) lines.push(`- ${agent.role}: ${agent.title ?? agent.id}${agent.agent ? ` · ${agent.agent}` : ''}${agent.model ? ` · ${agent.model}` : ''}${agent.effort ? ` (${agent.effort})` : ''} — ${agent.state}`)
  lines.push('', '## Timeline', '')
  for (const event of [...record.events].sort((a, b) => a.ts - b.ts)) lines.push(`- ${new Date(event.ts).toISOString()} \`${event.kind}\` ${event.summary}`)
  return lines.join('\n') + '\n'
}
