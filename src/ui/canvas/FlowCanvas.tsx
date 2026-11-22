// The interactive React Flow canvas: live graph, drag with persisted positions, multi-select,
// minimap, controls, context menu and keyboard shortcuts.
import { Background, BackgroundVariant, Controls, MarkerType, MiniMap, ReactFlow, ReactFlowProvider, useNodesInitialized, useReactFlow, type NodeChange } from '@xyflow/react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { actionsFor } from '../actions/entity-actions.ts'
import { useActionRunner } from '../actions/use-action-runner.tsx'
import { ContextMenu, type MenuItem } from '../components/overlays.tsx'
import { EmptyState, isTypingTarget, useNow } from '../components/primitives.tsx'
import { emptyCache, stabilize } from '../graph/stabilize.ts'
import { planViewport } from '../graph/fit.ts'
import { edgeTypes } from '../edges/FlowEdge.tsx'
import { useStatusColors } from '../state/use-status-colors.ts'
import { buildRawGraph, layoutPositions, structureKey } from '../graph/build-graph.ts'
import { assembleProjectGraph, assignmentKey, assignProjects, layoutProjects } from '../graph/group-projects.ts'
import { filterByProject } from '../graph/project-filter.ts'
import { NODE_SIZE } from '../graph/layout.ts'
import { onLayoutReady } from '../graph/layout-cache.ts'
import type { FlowEdge, FlowNode } from '../graph/types.ts'
import { nodeTypes } from '../nodes/index.tsx'
import { useApp, useFlowView, useViewState } from '../state/app-context.tsx'
import { CanvasActionsContext } from '../state/canvas-actions.ts'
import { createMotion, MotionContext, prefersReducedMotion } from '../state/motion.ts'
import { layoutKey } from '../state/view-store.ts'
import { onFocusRequest } from '../state/focus.ts'
import type { EntityRef } from '../graph/types.ts'
import { SelectionBar } from './SelectionBar.tsx'
import { firstBox, nextInDirection, type Box, type Direction } from '../graph/spatial-nav.ts'
import { cardLabel } from '../graph/status.ts'

const ARROWS: Record<string, Direction> = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' }

/** Arrow keys belong to the canvas only when focus is on it (or nowhere): menus, lists and tabs use them too. */
function canvasKeyTarget(target: EventTarget | null): boolean {
  if (target === document.body || target === document.documentElement || target === null) return true
  return target instanceof Element && Boolean(target.closest('.af-canvas')) && !target.closest('[role=menu],[role=dialog],[role=listbox],input,textarea,select')
}

const EMPTY_POSITIONS: Record<string, { x: number; y: number }> = {}
const FOCUS_STATUSES = new Set(['running', 'blocked', 'failed', 'waiting', 'review', 'testing'])

function sameSet(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size !== b.size) return false
  for (const item of a) if (!b.has(item)) return false
  return true
}

export function FlowCanvas() {
  return (
    <ReactFlowProvider>
      <CanvasInner />
    </ReactFlowProvider>
  )
}

function CanvasInner() {
  const { viewStore, client } = useApp()
  const flow = useFlowView()
  const view = useViewState()
  // Activity windows are 15 s; re-evaluate every 2 s (the canvas itself never re-renders per second).
  const nowBucket = useNow(true, 2000)
  const rf = useReactFlow()
  const runAction = useActionRunner()
  const [drag, setDrag] = useState<Record<string, { x: number; y: number }>>({})
  const [selection, setSelection] = useState<Set<string>>(new Set())
  const selectionRef = useRef(selection)
  selectionRef.current = selection
  /** Box sizes while a project box is being resized (saved on resize end). */
  const [resizing, setResizing] = useState<Record<string, { width: number; height: number }>>({})
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null)
  const reduced = useMemo(prefersReducedMotion, [])
  const statusColor = useStatusColors()

  // Presentation-only view fields (selection, panels, bottom tab) must not rebuild the graph.
  const graphView = useMemo(() => ({ ...view, selectedId: null, panels: view.panels, bottomTab: 'timeline' as const }), [view.mode, view.filters, view.collapsed, view.positions, view.layoutRevision, view.groupByProject, view.boxSizes]) // eslint-disable-line react-hooks/exhaustive-deps
  const allNodes = useMemo(() => buildRawGraph(flow.state, flow.events, graphView, nowBucket), [flow.state, flow.events, graphView, nowBucket])
  // Every node belongs to a project; used for the project filter and the project boxes.
  const assignment = useMemo(() => assignProjects(allNodes, flow.state), [allNodes, flow.state])
  const raw = useMemo(() => filterByProject(allNodes, assignment, graphView.filters.projectKey), [allNodes, assignment, graphView.filters.projectKey])
  const grouped = graphView.groupByProject
  const shape = structureKey(raw) + (grouped ? '#' + assignmentKey(assignment) : '')
  const manual = graphView.positions[layoutKey(graphView)] ?? EMPTY_POSITIONS
  // Big boxes are laid out in the layout worker; a provisional layout shows until it is ready.
  const [layoutTick, setLayoutTick] = useState(0)
  useEffect(() => onLayoutReady(() => setLayoutTick((t) => t + 1)), [])
  // Dagre runs only when the shape, the mode, saved positions, box sizes or collapsed boxes change.
  const flatPositions = useMemo(() => (grouped ? null : layoutPositions(raw, graphView)), [shape, grouped, graphView.mode, manual, graphView.layoutRevision, layoutTick]) // eslint-disable-line react-hooks/exhaustive-deps
  const boxLayout = useMemo(() => (grouped ? layoutProjects(raw, assignment, graphView, manual) : null), [shape, grouped, graphView.mode, manual, graphView.layoutRevision, graphView.collapsed, graphView.boxSizes, layoutTick]) // eslint-disable-line react-hooks/exhaustive-deps
  const graph = useMemo(() => {
    const sized = (n: FlowNode): FlowNode => (n.type === 'project' ? n : { ...n, width: NODE_SIZE[n.data.kind].width, height: NODE_SIZE[n.data.kind].height })
    if (boxLayout) {
      const assembled = assembleProjectGraph(raw, assignment, boxLayout, flow.state)
      return { nodes: assembled.nodes.map(sized), edges: assembled.edges }
    }
    return { nodes: raw.nodes.map((n) => sized({ ...n, position: flatPositions?.get(n.id) ?? n.position })), edges: raw.edges }
  }, [raw, assignment, boxLayout, flatPositions, flow.state])

  // Rebuilds produce fresh objects; keep the old ones where nothing changed so only the cards and
  // edges that really changed re-render.
  const nodeCache = useRef(emptyCache<FlowNode>())
  const edgeCache = useRef(emptyCache<FlowEdge>())
  const nodes: FlowNode[] = useMemo(
    () =>
      stabilize(
        nodeCache.current,
        graph.nodes.map((node) => ({
          ...node,
          position: drag[node.id] ?? node.position,
          ...(resizing[node.id] ? { width: resizing[node.id].width, height: resizing[node.id].height, style: { ...node.style, ...resizing[node.id] } } : {}),
          // Several cards: the multi-selection. One or none: whatever is selected anywhere (explorer too).
          selected: selection.size > 1 ? selection.has(node.id) : node.id === view.selectedId,
          // The focusable card wrapper gets the same name screen readers hear inside the card.
          ...(node.type === 'project' ? {} : { ariaLabel: cardLabel(node.data) }),
          data: { ...node.data, direction: 'LR' }
        }))
      ),
    [graph.nodes, drag, resizing, view.mode, selection, view.selectedId]
  )
  const edges: FlowEdge[] = useMemo(
    () =>
      stabilize(
        edgeCache.current,
        graph.edges.map((e) => ({
          ...e,
          markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16, color: statusColor[e.data?.status ?? 'ready'] }
        }))
      ),
    [graph.edges, statusColor]
  )
  const activeKey = edges.filter((e) => e.data?.active).map((e) => e.id).join('|')
  const motion = useMemo(() => createMotion(activeKey ? activeKey.split('|') : [], reduced), [activeKey, reduced])

  // Fit when the view mode or filters change, and once data first arrives. With several project
  // boxes, start on the busiest one (the top box); the fit button and minimap show everything.
  const fittedFor = useRef<string>('')
  const userMoved = useRef(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const fit = useCallback(() => {
    const first = boxLayout && boxLayout.boxes.length > 1 && view.filters.projectKey === 'all' ? boxLayout.boxes[0] : null
    requestAnimationFrame(() => {
      // Card sizes are fixed, so the camera is computed directly (no waiting on measurement).
      const rect = containerRef.current?.getBoundingClientRect()
      const all = rf.getNodes()
      if (!rect || !all.length) return
      const whole = rf.getNodesBounds(first ? [`box:${first.key}`] : all)
      const cards = all.filter((n) => n.type !== 'project')
      const busy = cards.filter((n) => FOCUS_STATUSES.has(String(n.data.status)))
      const focus = (busy.length ? busy : cards).slice(0, 12)
      void rf.setViewport(planViewport(whole, focus.length ? rf.getNodesBounds(focus) : null, rect), { duration: 250 })
    })
  }, [boxLayout, view.filters.projectKey, rf])
  // Fit only once React Flow has measured the cards; before that a fit has nothing to measure.
  const measured = useNodesInitialized()
  useEffect(() => {
    const key = `${view.mode}|${view.filters.runId}|${view.filters.projectKey}|${view.groupByProject}|${view.filters.activeOnly}|${view.layoutRevision}|${nodes.length > 0}`
    if (fittedFor.current === key || !nodes.length || !measured) return
    fittedFor.current = key
    userMoved.current = false
    fit()
  }, [view.mode, view.filters.runId, view.filters.projectKey, view.groupByProject, view.filters.activeOnly, view.layoutRevision, nodes.length, measured, fit])
  // Panels opening or closing change the canvas size: refit until the person pans or zooms.
  useEffect(() => {
    const el = containerRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    let timer: ReturnType<typeof setTimeout> | null = null
    const observer = new ResizeObserver(() => {
      if (userMoved.current) return
      if (timer) clearTimeout(timer)
      timer = setTimeout(fit, 120)
    })
    observer.observe(el)
    return () => {
      observer.disconnect()
      if (timer) clearTimeout(timer)
    }
  }, [fit])

  // Center a node another part of the UI asked for (e.g. the needs-attention list).
  useEffect(
    () =>
      onFocusRequest((id) => {
        // The card may appear a moment later (a filter was just changed to show it).
        const attempt = (left: number) => {
          if (!rf.getNode(id)) {
            if (left > 0) setTimeout(() => attempt(left - 1), 120)
            return
          }
          userMoved.current = true
          requestAnimationFrame(() => rf.fitView({ nodes: [{ id }], padding: 0.6, duration: 300, maxZoom: 1.2 }))
        }
        attempt(6)
      }),
    [rf]
  )

  const onNodesChange = useCallback(
    (changes: NodeChange<FlowNode>[]) => {
      const moving: Record<string, { x: number; y: number }> = {}
      const done: Record<string, { x: number; y: number }> = {}
      // Selection follows React Flow's change events only: they come from a person's clicks, box
      // selection or pane clicks. (Its onSelectionChange report also echoes our own prop changes,
      // one render late after a remount, which made the selection flip back and forth forever.)
      const selects = changes.filter((change) => change.type === 'select')
      if (selects.length) {
        const current = viewStore.get().selectedId
        const shown = selectionRef.current.size > 1 ? selectionRef.current : new Set(current ? [current] : [])
        const next = new Set(shown)
        for (const change of selects) if (change.type === 'select') change.selected ? next.add(change.id) : next.delete(change.id)
        if (!sameSet(next, selectionRef.current)) setSelection(next)
        const id = next.size === 1 ? [...next][0] : next.size === 0 ? null : current
        if (id !== current) viewStore.set({ selectedId: id })
      }
      for (const change of changes) {
        if (change.type === 'dimensions' && change.resizing && change.dimensions) {
          const size = { width: change.dimensions.width, height: change.dimensions.height }
          setResizing((r) => ({ ...r, [change.id]: size }))
        }
        if (change.type === 'dimensions' && change.resizing === false) setResizing((r) => {
          const next = { ...r }
          delete next[change.id]
          return next
        })
        if (change.type === 'position' && change.position) {
          if (change.dragging) moving[change.id] = change.position
          else done[change.id] = change.position
        }
      }
      if (Object.keys(moving).length) setDrag((d) => ({ ...d, ...moving }))
      if (Object.keys(done).length) {
        viewStore.savePositions(layoutKey(viewStore.get()), done)
        setDrag((d) => {
          const next = { ...d }
          for (const id of Object.keys(done)) delete next[id]
          return next
        })
      }
    },
    [viewStore]
  )

  const onNodeDragStop = useCallback(
    (_: unknown, _node: FlowNode, dragged: FlowNode[]) => {
      const positions: Record<string, { x: number; y: number }> = {}
      for (const node of dragged) positions[node.id] = node.position
      viewStore.savePositions(layoutKey(viewStore.get()), positions)
      setDrag({})
    },
    [viewStore]
  )

  const onNodeContextMenu = useCallback(
    (event: React.MouseEvent, node: FlowNode) => {
      event.preventDefault()
      viewStore.set({ selectedId: node.id })
      const state = client.getView().state
      const actions = actionsFor(node.data.entity, state, client.transport.kind === 'http' && state.capabilities.dashboardControls !== true)
      const items: MenuItem[] = [
        { label: 'Inspect', icon: 'eye', onSelect: () => viewStore.set({ selectedId: node.id, panels: { ...viewStore.get().panels, right: true } }) },
        ...(node.data.collapsible ? [{ label: node.data.collapsed ? 'Expand group' : 'Collapse group', icon: 'down' as const, onSelect: () => viewStore.toggleCollapsed(node.id, node.data.collapsed) }] : []),
        ...(actions.length ? (['separator'] as MenuItem[]) : []),
        ...actions.map((action) => ({ label: action.label, icon: action.icon, disabled: action.disabled, title: action.reason ?? undefined, danger: action.danger, onSelect: () => runAction(action) }))
      ]
      setMenu({ x: event.clientX, y: event.clientY, items })
    },
    [client, viewStore, runAction]
  )

  // Keyboard: f fit, l auto-layout, 1/2 switch views, Ctrl/⌘+A select all cards, Esc clear selection.
  const cardIds = useRef<string[]>([])
  cardIds.current = nodes.filter((n) => n.type !== 'project').map((n) => n.id)
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target)) return
      if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === 'a') {
        // Every card the filters show (for batch actions); project boxes are not selectable work.
        event.preventDefault()
        setSelection(new Set(cardIds.current))
        return
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return
      if (event.key === 'f') rf.fitView({ padding: 0.15, duration: 300 })
      else if (event.key === 'l') viewStore.resetLayout()
      else if (event.key === '1') viewStore.set({ mode: 'hierarchy' })
      else if (event.key === '2') viewStore.set({ mode: 'workflow' })
      else if (event.key === 'Escape') {
        setSelection(new Set())
        viewStore.set({ selectedId: null })
      }
      else if (ARROWS[event.key] && canvasKeyTarget(event.target)) moveSelection(ARROWS[event.key])
      else if (event.key === ' ' && event.target instanceof Element && event.target.matches('.react-flow__node')) {
        selectCard(event.target.getAttribute('data-id'))
      } else if (event.key === 'Enter' && viewStore.get().selectedId) viewStore.setPanels({ right: true })
      else return
      event.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [rf, viewStore]) // eslint-disable-line react-hooks/exhaustive-deps

  /** Select one card, keep it in view, and put keyboard focus on it. */
  const selectCard = (id: string | null) => {
    if (!id) return
    // Moved by keyboard: show the focus ring (cleared by the next pointer press).
    if (containerRef.current) containerRef.current.dataset.kbd = '1'
    setSelection(new Set())
    viewStore.set({ selectedId: id })
    const node = rf.getInternalNode(id)
    const rect = containerRef.current?.getBoundingClientRect()
    if (node && rect) {
      const { x, y, zoom } = rf.getViewport()
      const p = node.internals.positionAbsolute
      const w = (node.measured.width ?? node.width ?? 0) * zoom
      const h = (node.measured.height ?? node.height ?? 0) * zoom
      const sx = p.x * zoom + x
      const sy = p.y * zoom + y
      if (sx < 0 || sy < 0 || sx + w > rect.width || sy + h > rect.height) {
        userMoved.current = true
        void rf.setCenter(p.x + w / zoom / 2, p.y + h / zoom / 2, { zoom, duration: 200 })
      }
    }
    // After the camera moves the card exists in the DOM (off-screen cards may not be rendered).
    setTimeout(() => containerRef.current?.querySelector<HTMLElement>(`.react-flow__node[data-id="${CSS.escape(id)}"]`)?.focus({ preventScroll: true }), 220)
  }

  const moveSelection = (direction: Direction) => {
    const boxes: Box[] = rf
      .getNodes()
      .filter((n) => n.type !== 'project' && !n.hidden)
      .map((n) => {
        const internal = rf.getInternalNode(n.id)
        const p = internal?.internals.positionAbsolute ?? n.position
        return { id: n.id, x: p.x, y: p.y, width: n.measured?.width ?? n.width ?? 0, height: n.measured?.height ?? n.height ?? 0 }
      })
    const focused = document.activeElement instanceof Element ? document.activeElement.closest('.react-flow__node')?.getAttribute('data-id') : null
    const current = viewStore.get().selectedId
    const from = boxes.find((b) => b.id === current) ?? boxes.find((b) => b.id === focused)
    selectCard(from ? nextInDirection(from, boxes, direction) : firstBox(boxes))
  }

  const selectedEntities = useMemo<EntityRef[]>(() => (selection.size < 2 ? [] : nodes.filter((n) => selection.has(n.id) && n.type !== 'project').map((n) => n.data.entity)), [nodes, selection])
  const clearSelection = useCallback(() => {
    setSelection(new Set())
    viewStore.set({ selectedId: null })
  }, [viewStore])

  const closeMenu = useCallback(() => setMenu(null), [])
  const canvasActions = useMemo(() => ({ toggleCollapsed: (id: string, current?: boolean) => viewStore.toggleCollapsed(id, current), resizeBox: (key: string, size: { width: number; height: number }) => viewStore.saveBoxSize(key, size) }), [viewStore])

  if (!nodes.length) {
    return (
      <div className="af-canvas" style={{ display: 'grid', placeItems: 'center' }}>
        <EmptyState title={!flow.loaded ? 'Connecting to Orca…' : 'No agents to show yet'}>
          {flow.error ? (
            <span>{flow.error}</span>
          ) : view.mode === 'workflow' ? (
            'The workflow view shows orchestration tasks. Start an orchestration run (orca orchestration) and its tasks appear here.'
          ) : (
            'Agents appear here as soon as Orca reports them: open an agent tab, or start an orchestration run.'
          )}
        </EmptyState>
      </div>
    )
  }

  return (
    <div
      className="af-canvas"
      ref={containerRef}
      onPointerDownCapture={() => {
        if (containerRef.current) delete containerRef.current.dataset.kbd
      }}
      onFocusCapture={(event) => {
        // Tabbing onto a card selects it (keyboard focus only: a click selects through React Flow).
        const target = event.target as Element
        if (!target.matches?.('.react-flow__node:focus-visible') || target.matches('.react-flow__node-project')) return
        const id = target.getAttribute('data-id')
        if (containerRef.current) containerRef.current.dataset.kbd = '1'
        if (id && id !== viewStore.get().selectedId) {
          setSelection(new Set())
          viewStore.set({ selectedId: id })
        }
      }}
    >
      <MotionContext.Provider value={motion}>
        <CanvasActionsContext.Provider value={canvasActions}>
          <ReactFlow<FlowNode, FlowEdge>
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            onNodesChange={onNodesChange}
            onNodeDragStop={onNodeDragStop}
            onNodeContextMenu={onNodeContextMenu}
            onPaneClick={() => setMenu(null)}
            onMoveStart={(event) => {
              // Only a person's pan or zoom (with an input event) stops the automatic refit.
              if (event) userMoved.current = true
            }}
            onNodeDoubleClick={(_, node) => viewStore.set({ selectedId: node.id, panels: { ...viewStore.get().panels, right: true } })}
            nodesConnectable={false}
            // Arrow keys move between cards (spatial navigation), not move the selected card.
            disableKeyboardA11y
            edgesFocusable={false}
            selectionOnDrag
            panOnDrag={[1, 2]}
            panOnScroll
            zoomOnPinch
            multiSelectionKeyCode={['Shift', 'Meta', 'Control']}
            minZoom={0.1}
            maxZoom={2}
            proOptions={{ hideAttribution: true }}
            onlyRenderVisibleElements={nodes.length > 120}
          >
            <Background variant={BackgroundVariant.Dots} gap={18} size={1.4} color="var(--af-canvas-dot)" />
            {/* Project boxes are outlines in the minimap; filled, a box hides the cards inside it. */}
            <MiniMap
              pannable
              zoomable
              style={{ width: 168, height: 108 }}
              nodeStrokeWidth={3}
              nodeColor={(node) => (node.type === 'project' ? 'transparent' : (statusColor[(node.data as FlowNode['data']).status] ?? statusColor.ready))}
              nodeStrokeColor={(node) => (node.type === 'project' ? (statusColor[(node.data as FlowNode['data']).status] ?? statusColor.ready) : 'transparent')}
              maskColor="color-mix(in srgb, var(--af-bg) 60%, transparent)"
            />
            <Controls showInteractive={false} />
          </ReactFlow>
        </CanvasActionsContext.Provider>
      </MotionContext.Provider>
      {menu ? <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={closeMenu} /> : null}
      <SelectionBar entities={selectedEntities} onClear={clearSelection} />
    </div>
  )
}
