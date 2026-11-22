// Shared n8n-style node card: kind icon, title, subtitle, chips, status, timer, progress.
import { Handle, Position } from '@xyflow/react'
import { memo, useContext } from 'react'
import { Chip, Duration, StatusDot } from '../components/primitives.tsx'
import { Icon, type IconName } from '../components/Icon.tsx'
import { AgentLogo } from '../components/AgentLogo.tsx'
import { cardLabel, formatTokens, KIND_LABEL, STATUS_LABEL } from '../graph/status.ts'
import type { FlowNodeData } from '../graph/types.ts'
import { CanvasActionsContext } from '../state/canvas-actions.ts'

const KIND_ICON: Record<FlowNodeData['kind'], IconName> = {
  lead: 'crown',
  team: 'users',
  agent: 'bot',
  subagent: 'spark',
  task: 'task',
  review: 'review',
  test: 'test',
  worktree: 'branch',
  blocker: 'block',
  project: 'folder'
}


export const NodeShell = memo(function NodeShell({ id, data }: { id: string; data: FlowNodeData }) {
  const actions = useContext(CanvasActionsContext)
  const vertical = data.direction !== 'LR'
  const compact = data.kind === 'team' || data.kind === 'subagent' || data.kind === 'worktree' || data.kind === 'blocker'
  const tokens = formatTokens(data.tokens)
  // Agents show the real mark of the AI they run; leads and subagents keep a small role badge.
  const agentKind = typeof data.agentKind === 'string' ? data.agentKind : null
  const showsLogo = Boolean(agentKind) && (data.kind === 'agent' || data.kind === 'subagent' || data.kind === 'lead' || data.kind === 'task' || data.kind === 'review' || data.kind === 'test')
  const classes = ['af-node', compact ? 'compact' : '', data.live ? 'live' : '', data.dimmed ? 'dimmed' : '', data.highlighted ? 'highlighted' : ''].filter(Boolean).join(' ')
  return (
    <div className={classes} data-kind={data.kind} data-status={data.status} aria-label={cardLabel(data)}>
      <Handle type="target" position={vertical ? Position.Top : Position.Left} isConnectable={false} />
      {showsLogo ? (
        <div className="af-node-icon has-logo">
          <AgentLogo agent={agentKind} size={compact ? 32 : 40} />
          {data.kind !== 'agent' ? (
            <span className="af-kind-badge" title={KIND_LABEL[data.kind]}>
              <Icon name={KIND_ICON[data.kind]} size={11} />
            </span>
          ) : null}
        </div>
      ) : (
        <div className="af-node-icon">
          <Icon name={KIND_ICON[data.kind]} size={compact ? 16 : 19} />
        </div>
      )}
      <div className="af-node-body">
        <div className="af-node-title">
          <StatusDot status={data.status} live={data.live} />
          <span className="t" title={data.title}>
            {data.title}
          </span>
        </div>
        {data.subtitle ? (
          <div className="af-node-sub" title={data.subtitle}>
            {data.subtitle}
          </div>
        ) : null}
        {data.details?.length ? (
          <div className="af-node-details">
            {data.details.slice(0, compact ? 1 : 3).map((d) => (
              <div key={d.icon + d.text} className={`af-node-detail ${d.mono ? 'mono' : ''}`} title={d.title ?? d.text}>
                <Icon name={d.icon === 'agent' ? 'bot' : d.icon} size={12} />
                <span>{d.text}</span>
              </div>
            ))}
          </div>
        ) : null}
        {data.chips.length && !compact ? (
          <div className="af-node-meta">
            {data.chips.slice(0, 4).map((chip) => (
              <Chip key={chip.label} tone={chip.tone} title={chip.title}>
                {chip.label}
              </Chip>
            ))}
          </div>
        ) : null}
        {data.error ? <div className="af-node-error" title={data.error}>{data.error}</div> : null}
        {data.progress ? (
          <div className="af-node-progress" title={`${data.progress.done} of ${data.progress.total} tasks finished`}>
            <i style={{ width: `${Math.round((data.progress.done / Math.max(1, data.progress.total)) * 100)}%` }} />
          </div>
        ) : null}
        {!compact ? (
          <div className="af-node-foot">
            <span className="status">{STATUS_LABEL[data.status]}</span>
            <Duration since={data.since} until={data.until} />
            {tokens ? <span title="Tokens (Agent Session History)">{tokens} tok</span> : null}
            {data.progress ? <span>{data.progress.done}/{data.progress.total}</span> : null}
          </div>
        ) : null}
      </div>
      {data.collapsible && data.childCount > 0 ? (
        <button
          className="af-node-toggle nodrag"
          title={data.collapsed ? 'Expand' : 'Collapse'}
          aria-expanded={!data.collapsed}
          onClick={(event) => {
            event.stopPropagation()
            actions.toggleCollapsed(id, data.collapsed)
          }}
        >
          {data.collapsed ? `+${data.childCount}` : '−'}
        </button>
      ) : null}
      <Handle type="source" position={vertical ? Position.Bottom : Position.Right} isConnectable={false} />
    </div>
  )
})
