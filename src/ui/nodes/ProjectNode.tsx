// A project box (n8n-style group frame): name, path, live count and the AIs working inside.
// Movable, resizable and collapsible; its agents and tasks live inside it.
import { NodeResizer, type NodeProps } from '@xyflow/react'
import { memo, useContext } from 'react'
import { AgentLogo } from '../components/AgentLogo.tsx'
import { Icon } from '../components/Icon.tsx'
import { StatusDot } from '../components/primitives.tsx'
import type { FlowNode } from '../graph/types.ts'
import { CanvasActionsContext } from '../state/canvas-actions.ts'

export const ProjectNode = memo(function ProjectNode({ id, data, selected }: NodeProps<FlowNode>) {
  const actions = useContext(CanvasActionsContext)
  const color = typeof data.projectColor === 'string' ? data.projectColor : null
  const kinds = Array.isArray(data.agentKinds) ? (data.agentKinds as string[]) : []
  const live = typeof data.liveAgents === 'number' ? data.liveAgents : 0
  const total = typeof data.agentCount === 'number' ? data.agentCount : 0
  const tasks = typeof data.taskCount === 'number' ? data.taskCount : 0
  const countLabel = live ? `${live} live` : total ? `${total} agent${total === 1 ? '' : 's'}` : tasks ? `${tasks} task${tasks === 1 ? '' : 's'}` : 'Empty'
  const key = typeof data.projectKey === 'string' ? data.projectKey : id
  return (
    <div className={`af-project ${data.collapsed ? 'collapsed' : ''}`} style={color ? ({ '--pc': color } as React.CSSProperties) : undefined} data-status={data.status}>
      {!data.collapsed ? (
        <NodeResizer isVisible={Boolean(selected)} minWidth={320} minHeight={140} lineClassName="af-project-resize" handleClassName="af-project-handle" onResizeEnd={(_, size) => actions.resizeBox?.(key, { width: size.width, height: size.height })} />
      ) : null}
      <div className="af-project-head">
        <span className="af-project-icon">
          <Icon name="folder" size={16} />
        </span>
        <div className="af-project-titles">
          <div className="af-project-title" title={data.title}>
            {data.title}
            {data.projectSource === 'rule' ? <span className="af-chip" title="Grouped by your path rule">rule</span> : null}
          </div>
          {data.subtitle ? (
            <div className="af-project-path" title={data.subtitle}>
              {data.subtitle}
            </div>
          ) : null}
        </div>
        <div className="af-project-meta">
          <span className="af-project-logos">
            {kinds.slice(0, 5).map((kind) => (
              <AgentLogo key={kind} agent={kind} size={18} radius={5} />
            ))}
          </span>
          <span className="af-project-count" title={`${live} live of ${total} agents${tasks ? `, ${tasks} tasks` : ''} shown`}>
            <StatusDot status={live ? 'running' : data.status} live={live > 0} />
            {countLabel}
          </span>
          <button
            className="af-btn ghost icon sm nodrag"
            title={data.collapsed ? 'Expand project' : 'Collapse project'}
            aria-expanded={!data.collapsed}
            onClick={(event) => {
              event.stopPropagation()
              actions.toggleCollapsed(id, data.collapsed)
            }}
          >
            <Icon name={data.collapsed ? 'chevron' : 'down'} size={14} />
          </button>
        </div>
      </div>
    </div>
  )
})
