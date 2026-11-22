// Right sidebar: details of the selected node. Shows only what Orca reported; missing values are
// marked unavailable, inferred ones are labelled as inferred.
import { useEffect, useMemo, useState } from 'react'
import { newRequestId } from '../../shared/commands.ts'
import type { AgentRecord, FlowState, TaskRecord } from '../../shared/model.ts'
import { actionsFor } from '../actions/entity-actions.ts'
import { useActionRunner } from '../actions/use-action-runner.tsx'
import { Icon } from '../components/Icon.tsx'
import { Button, Chip, clock, Duration, EmptyState, StatusText, Tabs, Value } from '../components/primitives.tsx'
import { agentKindLabel, agentStatus, formatTokens, taskStatus } from '../graph/status.ts'
import type { EntityRef } from '../graph/types.ts'
import { useApp, useFlowView, useViewState } from '../state/app-context.tsx'
import { GitPanel } from '../lazy.tsx'
import { ScrollArea } from '../components/ui/ScrollArea.tsx'
import { OutputPanel } from './inspector/OutputPanel.tsx'
import { preloadChat } from '../chat/LazyAgentChat.tsx'

type Tab = 'overview' | 'output' | 'activity' | 'git' | 'controls'

export function Inspector() {
  const { viewStore } = useApp()
  const { state, events } = useFlowView()
  const view = useViewState()
  const [tab, setTab] = useState<Tab>('overview')
  const entity = useMemo(() => resolveEntity(view.selectedId, state), [view.selectedId, state])
  useEffect(() => setTab((t) => (t === 'output' || t === 'git' ? t : 'overview')), [view.selectedId])
  // Selecting something usually leads to its chat: fetch the chat code in the background.
  useEffect(() => {
    if (view.selectedId) preloadChat()
  }, [view.selectedId])

  if (!entity) {
    return (
      <>
        <div className="af-panel-head">
          <span className="grow">Inspector</span>
        </div>
        <EmptyState icon="eye" title="Nothing selected">
          Click a node to see its task, output, activity, worktree and controls. Right-click a node for quick actions.
        </EmptyState>
      </>
    )
  }
  const agent = entity.type === 'agent' ? state.agents[entity.id] : undefined
  const task = entity.type === 'task' ? state.tasks[entity.id] : agent?.taskId ? state.tasks[agent.taskId] : undefined
  const worktreePath = agent?.worktreePath ?? (task?.assigneeAgentId ? state.agents[task.assigneeAgentId]?.worktreePath : undefined) ?? (entity.type === 'worktree' ? (state.worktrees[entity.id]?.path ?? entity.id) : undefined)
  const outputAgent = agent ?? (task?.assigneeAgentId ? state.agents[task.assigneeAgentId] : undefined)
  const title = agent ? (agent.role === 'lead' ? 'Lead orchestrator' : agent.title ?? agentKindLabel(agent.agent)) : task ? task.displayName ?? task.title : entity.type === 'worktree' ? (state.worktrees[entity.id]?.name ?? entity.id) : entity.type === 'gate' ? 'Decision gate' : entity.id
  const related = new Set([entity.id, agent?.taskId, task?.id, task?.assigneeAgentId].filter(Boolean) as string[])
  const relatedEvents = events.filter((event) => related.has(event.entityId) || (event.targetId && related.has(event.targetId)))

  return (
    <>
      <div className="af-panel-head">
        <span className="grow" title={title}>{title}</span>
        <Button size="sm" iconOnly variant="ghost" icon="close" aria-label="Close inspector" onClick={() => viewStore.set({ selectedId: null })} />
      </div>
      <Tabs<Tab>
        fill
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'overview', label: 'Info', icon: 'eye', title: 'Overview' },
          { id: 'output', label: 'Chat', icon: 'message', title: 'Conversation, output and prompt' },
          { id: 'activity', label: 'Log', icon: 'history', title: `Activity: ${relatedEvents.length} events`, badge: relatedEvents.length || undefined },
          { id: 'git', label: 'Git', icon: 'branch' },
          { id: 'controls', label: 'Actions', icon: 'settings', title: 'Controls' }
        ]}
      />
      {/* The chat tab scrolls inside its own thread; the other tabs scroll here. */}
      {tab === 'output' ? (
        <div className="af-scroll af-scroll-chat">{outputAgent ? <OutputPanel agent={outputAgent} /> : <EmptyState icon="terminal" title="No output source">Output is available for agents and for tasks that have a worker.</EmptyState>}</div>
      ) : (
      <ScrollArea className="af-scroll">
        {tab === 'overview' ? <Overview entity={entity} state={state} /> : null}
        {tab === 'activity' ? <Activity events={relatedEvents} agent={agent} state={state} /> : null}
        {tab === 'git' ? (worktreePath ? <GitPanel path={worktreePath} /> : <EmptyState icon="branch" title="No worktree">Orca did not report a worktree for this item.</EmptyState>) : null}
        {tab === 'controls' ? <Controls entity={entity} state={state} /> : null}
      </ScrollArea>
      )}
    </>
  )
}

function resolveEntity(id: string | null, state: FlowState): EntityRef | null {
  if (!id) return null
  if (state.agents[id]) return { type: 'agent', id }
  if (state.tasks[id]) return { type: 'task', id }
  if (id.startsWith('gate:') && state.gates[id.slice(5)]) return { type: 'gate', id: id.slice(5) }
  if (id.startsWith('wt:')) {
    const path = id.slice(3)
    const wt = Object.values(state.worktrees).find((w) => w.path === path)
    return { type: 'worktree', id: wt?.id ?? path }
  }
  if (state.worktrees[id]) return { type: 'worktree', id }
  return null
}

function Overview({ entity, state }: { entity: EntityRef; state: FlowState }) {
  if (entity.type === 'agent') return <AgentOverview agent={state.agents[entity.id]} state={state} />
  if (entity.type === 'task') return <TaskOverview task={state.tasks[entity.id]} state={state} />
  if (entity.type === 'gate') {
    const gate = state.gates[entity.id]
    return (
      <div className="af-section">
        <dl className="af-kv">
          <dt>Status</dt>
          <dd>{gate.status}</dd>
          <dt>Task</dt>
          <dd>{gate.taskId ? state.tasks[gate.taskId]?.title ?? gate.taskId : <Value>{null}</Value>}</dd>
          <dt>Question</dt>
          <dd>{gate.question ?? <Value>{null}</Value>}</dd>
          <dt>Resolution</dt>
          <dd><Value unavailable="Pending">{gate.resolution}</Value></dd>
        </dl>
      </div>
    )
  }
  const wt = state.worktrees[entity.id] ?? Object.values(state.worktrees).find((w) => w.path === entity.id)
  return (
    <div className="af-section">
      <dl className="af-kv">
        <dt>Name</dt>
        <dd>{wt?.name ?? entity.id}</dd>
        <dt>Path</dt>
        <dd className="af-mono">{wt?.path ?? entity.id}</dd>
        <dt>Branch</dt>
        <dd><Value>{wt?.branch}</Value></dd>
        <dt>Project</dt>
        <dd><Value>{wt?.project}</Value></dd>
        <dt>Host</dt>
        <dd><Value>{wt?.hostId}</Value></dd>
        <dt>Terminals</dt>
        <dd><Value>{wt?.terminalCount}</Value></dd>
      </dl>
    </div>
  )
}

function AgentOverview({ agent, state }: { agent: AgentRecord; state: FlowState }) {
  const task = agent.taskId ? state.tasks[agent.taskId] : undefined
  const run = agent.runId ? state.runs[agent.runId] : undefined
  const parent = agent.parentId ? state.agents[agent.parentId] : undefined
  return (
    <>
      <div className="af-section">
        <dl className="af-kv">
          <dt>Status</dt>
          <dd>
            <StatusText status={agentStatus(agent)} /> {agent.live ? <Chip tone="accent" title={`Evidence: ${agent.evidence.join(', ')}`}>live</Chip> : <Chip title="No live runtime evidence right now">not live</Chip>}
          </dd>
          <dt>Role</dt>
          <dd>{agent.role}{agent.subagentType ? ` · ${agent.subagentType}` : ''}</dd>
          <dt>Agent</dt>
          <dd><Value>{agent.agent ? agentKindLabel(agent.agent) : null}</Value></dd>
          <dt>Model</dt>
          <dd className="af-mono"><Value>{agent.model}</Value></dd>
          <dt>Effort</dt>
          <dd><Value>{agent.effort}</Value></dd>
          <dt>Account</dt>
          <dd>{agent.account ? <>{agent.account.label ?? agent.account.accountId} <span className="af-muted">({agent.account.source === 'session-file' ? 'from session file' : agent.account.source === 'launch-capture' ? 'captured at launch' : agent.account.source})</span></> : <Value unavailable="Unknown: no session or launch evidence">{null}</Value>}</dd>
          <dt>Duration</dt>
          <dd><Value>{agent.startedAt ? <Duration since={agent.startedAt} until={agent.live ? null : agent.endedAt} /> : null}</Value></dd>
          <dt>Tokens</dt>
          <dd><Value unavailable="Not in Agent Session History">{formatTokens(agent.tokens)}</Value></dd>
          <dt>Cost</dt>
          <dd><span className="af-unavailable">Orca does not report cost</span></dd>
          <dt>Messages</dt>
          <dd><Value>{agent.messageCount}</Value></dd>
          {run ? (
            <>
              <dt>Run</dt>
              <dd>{run.objective}</dd>
            </>
          ) : null}
          {parent ? (
            <>
              <dt>Parent</dt>
              <dd>{parent.title ?? parent.id}</dd>
            </>
          ) : null}
          <dt>Worktree</dt>
          <dd className="af-mono"><Value>{agent.worktreePath}</Value></dd>
          <dt>Branch</dt>
          <dd className="af-mono"><Value>{agent.branch}</Value></dd>
          <dt>Session</dt>
          <dd className="af-mono"><Value>{agent.sessionId}</Value></dd>
          {agent.dispatchId ? (
            <>
              <dt>Dispatch</dt>
              <dd className="af-mono">{agent.dispatchId}{agent.retryOfDispatchId ? ` (retry of ${agent.retryOfDispatchId})` : ''}</dd>
            </>
          ) : null}
          {agent.failureCount ? (
            <>
              <dt>Failures</dt>
              <dd>{agent.failureCount}</dd>
            </>
          ) : null}
          {agent.outcome ? (
            <>
              <dt>Outcome</dt>
              <dd>{agent.outcome}</dd>
            </>
          ) : null}
        </dl>
      </div>
      {agent.description && agent.role === 'subagent' ? (
        <div className="af-section">
          <h4>Brief</h4>
          <div className="af-pre">{agent.description}</div>
        </div>
      ) : null}
      {task ? <TaskOverview task={task} state={state} heading="Current task" /> : null}
    </>
  )
}

function TaskOverview({ task, state, heading }: { task: TaskRecord; state: FlowState; heading?: string }) {
  const owner = task.assigneeAgentId ? state.agents[task.assigneeAgentId] : undefined
  return (
    <>
      <div className="af-section">
        {heading ? <h4>{heading}</h4> : null}
        <dl className="af-kv">
          <dt>Title</dt>
          <dd>{task.title}</dd>
          <dt>Status</dt>
          <dd>
            <StatusText status={taskStatus(task)} /> <span className="af-muted">(Orca: {task.orcaStatus})</span>
          </dd>
          <dt>Kind</dt>
          <dd>{task.kind} {task.kind !== 'task' ? <span className="af-muted">(inferred from title)</span> : null}</dd>
          <dt>Owner</dt>
          <dd><Value unavailable="Not dispatched">{owner ? `${owner.title ?? owner.id} · ${agentKindLabel(owner.agent)}` : null}</Value></dd>
          <dt>Depends on</dt>
          <dd>{task.deps.length ? task.deps.map((dep) => state.tasks[dep]?.displayName ?? state.tasks[dep]?.title ?? dep).join(', ') : 'None'}</dd>
          <dt>Attempts</dt>
          <dd>{task.dispatchIds.length}{task.retryCount ? ` (${task.retryCount} retr${task.retryCount > 1 ? 'ies' : 'y'})` : ''}</dd>
          <dt>Created</dt>
          <dd><Value>{task.createdAt ? new Date(task.createdAt).toLocaleString() : null}</Value></dd>
          <dt>Completed</dt>
          <dd><Value unavailable="Not yet">{task.completedAt ? new Date(task.completedAt).toLocaleString() : null}</Value></dd>
          <dt>Run</dt>
          <dd className="af-mono">{task.runId}</dd>
        </dl>
      </div>
      {task.result ? (
        <div className="af-section">
          <h4>Result {task.result.outcome ? <Chip tone={task.result.outcome === 'succeeded' ? 'success' : 'danger'}>{task.result.outcome}</Chip> : null}</h4>
          {task.result.message ? <FullText preview={task.result.message} detailKey={`result:${task.id}`} bare /> : null}
          {task.result.filesModified.length ? (
            <>
              <h4 style={{ marginTop: 8 }}>Files modified</h4>
              <div className="af-pre">{task.result.filesModified.join('\n')}</div>
            </>
          ) : null}
        </div>
      ) : null}
      {task.spec ? <FullText title="Spec and acceptance criteria" preview={task.spec} detailKey={`task:${task.id}`} /> : null}
    </>
  )
}

function FullText({ title, preview, detailKey, bare }: { title?: string; preview: string; detailKey: string; bare?: boolean }) {
  const { client } = useApp()
  const [full, setFull] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    setFull(null)
    setError(null)
  }, [detailKey])
  const truncated = preview.endsWith('…')
  const load = async () => {
    const response = await client.transport.command({ requestId: newRequestId(), kind: 'entity.detail', params: { key: detailKey } })
    if (response.ok) setFull((response.result as { text: string }).text)
    else setError(response.error.message)
  }
  const body = (
    <>
      <div className="af-pre" style={full ? { maxHeight: 640 } : undefined}>{full ?? preview}</div>
      {truncated && !full ? (
        <div style={{ marginTop: 6 }}>
          <Button size="sm" icon="down" onClick={() => void load()}>Show full text</Button>
          {error ? <span className="af-muted" style={{ marginLeft: 8, fontSize: 12 }}>{error}</span> : null}
        </div>
      ) : null}
    </>
  )
  if (bare) return body
  return (
    <div className="af-section">
      {title ? <h4>{title}</h4> : null}
      {body}
    </div>
  )
}

function Activity({ events, agent, state }: { events: ReturnType<typeof useFlowView>['events']; agent: AgentRecord | undefined; state: FlowState }) {
  const tools = agent ? state.toolCalls.filter((call) => call.agentId === agent.id).slice(-60).reverse() : []
  const messages = agent ? state.messages.filter((m) => m.fromAgentId === agent.id || m.toAgentId === agent.id).slice(-40).reverse() : []
  return (
    <>
      <div className="af-section">
        <h4>Events</h4>
        {events.length ? (
          [...events].reverse().slice(0, 150).map((event) => (
            <div key={event.id} className="af-timeline-row" style={{ gridTemplateColumns: '64px 1fr', padding: '2px 0' }}>
              <span className="af-muted">{clock(event.ts)}</span>
              <span className="sum" title={event.summary}>{event.summary}</span>
            </div>
          ))
        ) : (
          <div className="af-muted">No events recorded yet.</div>
        )}
      </div>
      {agent ? (
        <div className="af-section">
          <h4>Tool calls <span className="af-muted" style={{ textTransform: 'none' }}>(Orca hooks)</span></h4>
          {tools.length ? (
            tools.map((call) => (
              <div key={`${call.id}-${call.phase}`} style={{ display: 'flex', gap: 6, fontSize: 12, padding: '2px 0' }}>
                <span className="af-muted">{clock(call.at)}</span>
                <Chip tone={call.phase === 'started' ? 'accent' : 'muted'}>{call.tool}</Chip>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={call.summary}>{call.summary}</span>
              </div>
            ))
          ) : (
            <div className="af-muted" style={{ fontSize: 12 }}>None seen. Orca reports tool calls for agents in Orca terminals on this machine.</div>
          )}
        </div>
      ) : null}
      {messages.length ? (
        <div className="af-section">
          <h4>Messages</h4>
          {messages.map((m) => (
            <div key={m.id} style={{ marginBottom: 8 }}>
              <div style={{ fontSize: 12 }}>
                <Icon name="message" size={12} /> <b>{m.type}</b> <span className="af-muted">{clock(m.createdAt)}</span>
              </div>
              <div style={{ fontSize: 12 }}>{m.subject}</div>
              {m.body ? <div className="af-pre" style={{ maxHeight: 140 }}>{m.body}</div> : null}
            </div>
          ))}
        </div>
      ) : null}
    </>
  )
}

function Controls({ entity, state }: { entity: EntityRef; state: FlowState }) {
  const runAction = useActionRunner()
  const { client } = useApp()
  const actions = actionsFor(entity, state, client.transport.kind === 'http' && state.capabilities.dashboardControls !== true)
  if (!actions.length) return <EmptyState icon="settings" title="No controls">Orca offers no plugin controls for this item.</EmptyState>
  return (
    <div className="af-section" style={{ display: 'grid', gap: 10 }}>
      {actions.map((action) => (
        <div key={action.id} style={{ display: 'grid', gap: 4 }}>
          <Button icon={action.icon} variant={action.danger ? 'danger' : 'default'} disabled={action.disabled} onClick={() => runAction(action)} style={{ justifyContent: 'flex-start' }}>
            {action.label}
            {action.viaCoordinator && !action.disabled ? <Chip tone="warning">coordinator</Chip> : null}
          </Button>
          {action.reason ? <div className="af-muted" style={{ fontSize: 11.5 }}>{action.reason}</div> : null}
        </div>
      ))}
    </div>
  )
}
