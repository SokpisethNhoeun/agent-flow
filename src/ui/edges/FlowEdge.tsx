// n8n-style connection: smooth-step path, arrowhead, status colour, and particles that move
// along the path only while the edge has verified activity. A fresh event fires a one-shot pulse.
import { BaseEdge, EdgeLabelRenderer, getBezierPath, getSmoothStepPath, type EdgeProps } from '@xyflow/react'
import { memo, useContext } from 'react'
import type { FlowEdge as FlowEdgeType } from '../graph/types.ts'
import { MotionContext } from '../state/motion.ts'

export const STATUS_COLOR: Record<string, string> = {
  running: '#3b82f6',
  waiting: '#06b6d4',
  ready: '#94a3b8',
  idle: '#94a3b8',
  unknown: '#94a3b8',
  blocked: '#f59e0b',
  failed: '#ef4444',
  review: '#a855f7',
  testing: '#a855f7',
  done: '#22c55e',
  cancelled: '#9ca3af'
}

export const FlowEdge = memo(function FlowEdge(props: EdgeProps<FlowEdgeType>) {
  const { id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data, markerEnd, selected } = props
  const motion = useContext(MotionContext)
  const category = data?.category ?? 'hierarchy'
  const status = data?.status ?? 'ready'
  const [path, labelX, labelY] =
    category === 'message'
      ? getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, curvature: 0.35 })
      : getSmoothStepPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, borderRadius: 14, offset: 18 })
  const animate = Boolean(data?.active) && motion.enabled && motion.allow(id)
  const pathId = `af-path-${id.replace(/[^A-Za-z0-9_-]/g, '_')}`
  const particles = status === 'running' || status === 'review' || status === 'testing' || category === 'message' ? 3 : 1
  const duration = category === 'message' ? 1.4 : 2.2
  return (
    <g className={`af-edge ${animate ? 'active' : ''}`} data-status={status} data-category={category}>
      {animate || selected ? <path d={path} className="glow" /> : null}
      <BaseEdge id={pathId} path={path} markerEnd={markerEnd} className="base" interactionWidth={18} />
      {animate
        ? Array.from({ length: particles }, (_, i) => (
            <circle key={`${data?.pulseKey ?? 0}-${i}`} r={category === 'message' ? 3.2 : 2.8} className="particle">
              <animateMotion dur={`${duration}s`} begin={`${(i * duration) / particles}s`} repeatCount="indefinite" rotate="auto">
                <mpath href={`#${pathId}`} />
              </animateMotion>
            </circle>
          ))
        : null}
      {data?.label && (selected || animate) ? (
        <EdgeLabelRenderer>
          <div className="af-edge-label" style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}>
            {data.label}
          </div>
        </EdgeLabelRenderer>
      ) : null}
    </g>
  )
})

export const edgeTypes = { flow: FlowEdge }
