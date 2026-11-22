// Left sidebar: runs, agents (by team), tasks, accounts, models in use.
import type { ReactNode } from 'react'
import { Icon } from '../components/Icon.tsx'
import { AgentLogo } from '../components/AgentLogo.tsx'
import { Button, Chip, StatusDot } from '../components/primitives.tsx'
import { agentKindLabel, agentStatus, shortModel, taskStatus } from '../graph/status.ts'
import { useApp, useFlowView, useViewState } from '../state/app-context.tsx'
import { useExplorerData } from './explorer-data.ts'
import { ScrollArea } from '../components/ui/ScrollArea.tsx'
import { requestFocus } from '../state/focus.ts'

export function Explorer() {
  const { viewStore } = useApp()
  const { state } = useFlowView()
  const view = useViewState()
  const select = (id: string) => {
    viewStore.set({ selectedId: id })
    requestFocus(id)
  }
  const { projects, subagents, teams, tasks, runs, models, accounts, counts } = useExplorerData()

  return (
    <>
      <div className="af-panel-head">
        <span className="grow">Explorer</span>
        <Button size="sm" iconOnly variant="ghost" icon="collapseLeft" title="Collapse the sidebar to icons" aria-label="Collapse sidebar" onClick={() => viewStore.setPanels({ left: false })} />
      </div>
    <ScrollArea className="af-scroll" label="Explorer sections">
      <Section id="projects" title="Projects" count={counts.projects}>
        {projects.map((p) => (
          <Row key={p.key} selected={view.filters.projectKey === p.key} onClick={() => viewStore.setFilters({ projectKey: view.filters.projectKey === p.key ? 'all' : p.key })} status={p.live ? 'running' : 'idle'} live={p.live > 0} label={p.name} meta={p.live ? `${p.live} live` : p.total ? `${p.total}` : undefined} />
        ))}
      </Section>
      <Section id="runs" title="Runs" count={counts.runs}>
        {runs.length ? (
          runs.map((run) => (
            <Row key={run.id} selected={view.filters.runId === run.id} onClick={() => viewStore.setFilters({ runId: view.filters.runId === run.id ? 'all' : run.id })} status={run.state === 'active' ? 'running' : run.state === 'completed' ? 'done' : run.state === 'failed' ? 'failed' : 'idle'} label={run.objective} meta={`${run.taskCount}`} />
          ))
        ) : (
          <div className="af-muted" style={{ fontSize: 12 }}>No orchestration runs.</div>
        )}
      </Section>
      <Section id="agents" title="Agents" count={counts.agents}>
        {teams.map(([team, members]) => (
          <Group key={team} title={team}>
            {members.map((agent) => (
              <Row key={agent.id} selected={view.selectedId === agent.id} onClick={() => select(agent.id)} status={agentStatus(agent)} live={agent.live} label={agent.title ?? agentKindLabel(agent.agent)} meta={agentKindLabel(agent.agent)} agent={agent.agent} />
            ))}
          </Group>
        ))}
      </Section>
      <Section id="subagents" title="Subagents" count={counts.subagents}>
        {subagents
          .slice(-40)
          .reverse()
          .map((agent) => (
            <Row key={agent.id} selected={view.selectedId === agent.id} onClick={() => select(agent.id)} status={agentStatus(agent)} live={agent.live} label={agent.description ?? agent.title ?? 'Subagent'} meta={agent.subagentType ?? undefined} agent={agent.agent} />
          ))}
      </Section>
      <Section id="tasks" title="Tasks" count={counts.tasks}>
        {tasks.slice(0, 200).map((task) => (
          <Row key={task.id} selected={view.selectedId === task.id} onClick={() => select(task.id)} status={taskStatus(task)} label={task.displayName ?? task.title} meta={task.state.toLowerCase()} />
        ))}
      </Section>
      <Section id="accounts" title="Accounts" count={counts.accounts}>
        {accounts.map((account) => (
          <div key={account.id} className="af-tree-row" style={{ cursor: 'default' }} title={account.id}>
            <Icon name="account" size={13} />
            <span className="label">{state.labels.accountTeams[account.id] ? `${state.labels.accountTeams[account.id]} · ` : ''}{account.email ?? account.id}</span>
            <Chip>{account.provider}</Chip>
            {account.active ? <Chip tone="success" title="Account Orca uses for new launches">active</Chip> : null}
          </div>
        ))}
      </Section>
      <Section id="models" title="Models in use" count={counts.models}>
        {models.map(([model, liveCount]) => (
          <div key={model} className="af-tree-row" style={{ cursor: 'default' }}>
            <Icon name="cpu" size={13} />
            <span className="label" title={model}>{shortModel(model)}</span>
            {liveCount ? <Chip tone="accent">{liveCount} live</Chip> : null}
          </div>
        ))}
      </Section>
    </ScrollArea>
    </>
  )
}

/** A sidebar section; folded-shut sections are remembered with the other view settings. */
function Section({ id, title, count, children }: { id: string; title: string; count?: number | string; children: ReactNode }) {
  const { viewStore } = useApp()
  const view = useViewState()
  const open = !view.panels.closedSections?.[id]
  const setOpen = (next: boolean) => viewStore.setPanels({ closedSections: { ...(viewStore.get().panels.closedSections ?? {}), [id]: !next } })
  return (
    <div className="af-section" id={`af-section-${id}`}>
      <h4>
        <button className="af-btn ghost icon sm" onClick={() => setOpen(!open)} aria-expanded={open} aria-label={`${open ? 'Collapse' : 'Expand'} ${title}`}>
          <Icon name={open ? 'down' : 'chevron'} size={12} />
        </button>
        {title}
        {count !== undefined ? <span className="af-chip">{count}</span> : null}
      </h4>
      {open ? children : null}
    </div>
  )
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div style={{ marginBottom: 6 }}>
      <div className="af-muted" style={{ fontSize: 11, padding: '2px 6px', display: 'flex', gap: 6, alignItems: 'center' }}>
        <Icon name="users" size={12} />
        {title}
      </div>
      {children}
    </div>
  )
}

function Row({ label, meta, status, live, selected, onClick, agent }: { label: string; meta?: string; status: Parameters<typeof StatusDot>[0]['status']; live?: boolean; selected?: boolean; onClick: () => void; agent?: string | null }) {
  return (
    <button className="af-tree-row" aria-selected={selected} onClick={onClick} title={label}>
      <StatusDot status={status} live={live} />
      {agent !== undefined ? <AgentLogo agent={agent} size={16} radius={4} /> : null}
      <span className="label">{label}</span>
      {meta ? <span className="af-muted" style={{ fontSize: 11 }}>{meta}</span> : null}
    </button>
  )
}
