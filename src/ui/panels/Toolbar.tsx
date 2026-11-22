import { useEffect, useRef } from 'react'
import { Icon } from '../components/Icon.tsx'
import { Button, isTypingTarget } from '../components/primitives.tsx'
import { LabelsDialog, ProjectsDialog } from '../lazy.tsx'
import { AttentionButton } from './AttentionButton.tsx'
import { Segmented } from '../components/ui/Controls.tsx'
import { Select } from '../components/ui/Select.tsx'
import { ProjectPicker } from './ProjectPicker.tsx'
import { runHint, RunSummaryChip } from './RunSummaryChip.tsx'
import { summarizeRun } from '../graph/run-summary.ts'
import { useApp, useFlowView, useViewState } from '../state/app-context.tsx'

export function Toolbar({ onFit }: { onFit?: () => void }) {
  const { viewStore, surface, openDialog, client, runCommand, toast } = useApp()
  const flow = useFlowView()
  const view = useViewState()
  const searchRef = useRef<HTMLInputElement>(null)
  const runs = Object.values(flow.state.runs).sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0))
  const running = Object.values(flow.state.agents).filter((a) => a.live && a.state === 'working').length
  const compact = surface === 'panel'

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === '/' && !isTypingTarget(event.target)) {
        event.preventDefault()
        searchRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const openDashboard = async () => {
    const response = await runCommand('dashboard.info', {})
    let info = response?.ok ? (response.result as { enabled: boolean; url: string | null }) : null
    if (!info?.url) {
      const turnOn = await runCommand('dashboard.enable', { enabled: true }, {
        title: 'Turn on the browser dashboard?',
        message: 'Agent Flow will serve this live canvas on 127.0.0.1 (this computer only), protected by a secret token. Controls from the browser follow the “Allow controls from the browser dashboard” setting. You can turn it off under Agent Flow in Orca Settings.',
        label: 'Turn on'
      })
      info = turnOn?.ok ? (turnOn.result as { enabled: boolean; url: string | null }) : null
      if (!info?.url) {
        if (turnOn?.ok) toast('The dashboard could not start; see `orca plugin logs`.', 'failed')
        return
      }
    }
    if (client.transport.openExternal) await client.transport.openExternal(info.url)
  }

  return (
    <div className="af-toolbar" role="toolbar" aria-label="Agent Flow">
      <div className="af-brand">
        <Icon name="flow" size={18} />
        <span>Agent Flow</span>
      </div>
      <Segmented
        ariaLabel="View"
        value={view.mode}
        onChange={(mode) => viewStore.set({ mode })}
        options={[
          { value: 'hierarchy', label: 'Hierarchy', title: 'Agent hierarchy (1)' },
          { value: 'workflow', label: 'Workflow', title: 'Workflow execution (2)' }
        ]}
      />
      <Select
        ariaLabel="Orchestration run"
        value={view.filters.runId}
        onChange={(runId) => viewStore.setFilters({ runId })}
        style={{ maxWidth: compact ? 150 : 260 }}
        options={[
          { value: 'all', label: 'All runs and agents' },
          ...runs.map((run) => ({ value: run.id, label: run.objective.slice(0, 90), hint: runHint(run.state, summarizeRun(flow.state, run.id, Date.now())), dot: run.state === 'active' ? ('live' as const) : ('muted' as const) }))
        ]}
      />
      {!compact && view.filters.runId !== 'all' ? <RunSummaryChip runId={view.filters.runId} /> : null}
      <ProjectPicker />
      <div className="af-search">
        <Icon name="search" size={13} />
        <input ref={searchRef} className="af-input" placeholder="Search nodes (/)" value={view.filters.search} onChange={(e) => viewStore.setFilters({ search: e.target.value })} aria-label="Search nodes" />
      </div>
      <Segmented
        ariaLabel="Which agents"
        value={view.filters.activeOnly ? 'active' : 'all'}
        onChange={(v) => viewStore.setFilters({ activeOnly: v === 'active' })}
        options={[
          { value: 'active', label: 'Active', title: 'Only agents Orca reports as working, waiting or blocked right now' },
          { value: 'all', label: 'All', title: 'Everything, including finished runs and agents' }
        ]}
      />
      <AttentionButton />
      <span className="grow" />
      <span className="af-conn" title={flow.error ?? undefined}>
        <span className={`af-dot ${flow.status === 'live' && running ? 'pulse' : ''}`} data-status={flow.status === 'live' ? (running ? 'running' : 'done') : flow.status === 'offline' ? 'failed' : 'blocked'} />
        {flow.mode === 'replay' ? 'Replay' : flow.status === 'live' ? (running ? `${running} running` : 'Live') : flow.status === 'offline' ? 'Offline' : 'Connecting…'}
      </span>
      <Button size="sm" iconOnly icon="layout" title="Auto-layout (l)" onClick={() => viewStore.resetLayout()} />
      {onFit ? <Button size="sm" iconOnly icon="fit" title="Fit to view (f)" onClick={onFit} /> : null}
      {!compact ? (
        <>
          <Button size="sm" iconOnly icon="bottom" title="Toggle timeline" onClick={() => viewStore.setPanels({ bottom: !view.panels.bottom })} aria-pressed={view.panels.bottom} />
          <Button size="sm" iconOnly icon="right" title="Toggle inspector" onClick={() => viewStore.setPanels({ right: !view.panels.right })} aria-pressed={view.panels.right} />
        </>
      ) : null}
      <Button size="sm" iconOnly icon="folder" title="Project boxes: names, colors and path rules" onClick={() => openDialog((close) => <ProjectsDialog onClose={close} />)} />
      <Button size="sm" iconOnly icon="users" title="Team and role labels" onClick={() => openDialog((close) => <LabelsDialog onClose={close} />)} />
      {surface !== 'dashboard' ? <Button size="sm" iconOnly icon="external" title="Open the browser dashboard" onClick={() => void openDashboard()} /> : null}
    </div>
  )
}
