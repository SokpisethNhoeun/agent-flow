import { useEffect, useState } from 'react'
// Layout: toolbar, collapsible/resizable explorer · canvas · inspector, bottom timeline.
import { FlowCanvas } from './canvas/FlowCanvas.tsx'
import { ResizeHandle } from './components/overlays.tsx'
import { BottomPanel } from './lazy.tsx'
import { ReplayBar } from './panels/ReplayBar.tsx'
import { Explorer } from './panels/Explorer.tsx'
import { ExplorerRail } from './panels/ExplorerRail.tsx'
import { Inspector } from './panels/Inspector.tsx'
import { Toolbar } from './panels/Toolbar.tsx'
import { LiveAnnouncer } from './components/LiveAnnouncer.tsx'
import { useApp, useFlowView, useViewState } from './state/app-context.tsx'

const NARROW_PX = 900
/** Width of the collapsed sidebar (icon rail). */
const RAIL_PX = 44

function useWindowWidth(): number {
  const [width, setWidth] = useState(() => window.innerWidth)
  useEffect(() => {
    const onResize = () => setWidth(window.innerWidth)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  return width
}

export function App() {
  const { surface, viewStore } = useApp()
  const view = useViewState()
  const flow = useFlowView()
  // The sidebar panel, and any narrow window, use the compact layout (inspector as an overlay).
  const width = useWindowWidth()
  const compact = surface === 'panel' || width < NARROW_PX
  const { panels } = view
  // The sidebar panel is narrow: the inspector overlays the canvas there instead of a column.
  const showRight = panels.right || (compact && Boolean(view.selectedId))
  const caps = flow.state.capabilities
  return (
    <div className={`af-app ${compact ? 'af-compact' : ''}`}>
      <LiveAnnouncer />
      <div>
        <Toolbar />
        <ReplayBar />
        {flow.loaded && !caps.cliAvailable ? (
          <div className="af-banner">The orca CLI was not found, so orchestration runs, tasks and their controls are off. Set its path under Agent Flow in Orca Settings.</div>
        ) : null}
      </div>
      <div className="af-main" style={{ gridTemplateColumns: compact ? '1fr' : `${panels.left ? `${panels.leftWidth}px auto` : `${RAIL_PX}px`} 1fr ${showRight ? `auto ${panels.rightWidth}px` : ''}`.trim() }}>
        {!compact && panels.left ? (
          <>
            <aside className="af-side left" aria-label="Explorer">
              <Explorer />
            </aside>
            <ResizeHandle direction="v" getSize={() => viewStore.get().panels.leftWidth} onResize={(leftWidth) => viewStore.setPanels({ leftWidth })} max={520} />
          </>
        ) : null}
        {!compact && !panels.left ? (
          <aside className="af-side left rail" aria-label="Explorer">
            <ExplorerRail />
          </aside>
        ) : null}
        <div className="af-center" style={{ gridTemplateRows: !compact && panels.bottom ? `1fr auto ${panels.bottomHeight}px` : '1fr' }}>
          <FlowCanvas />
          {!compact && panels.bottom ? (
            <>
              <ResizeHandle direction="h" invert getSize={() => viewStore.get().panels.bottomHeight} onResize={(bottomHeight) => viewStore.setPanels({ bottomHeight })} min={100} max={600} />
              <section className="af-bottom" aria-label="Timeline">
                <BottomPanel />
              </section>
            </>
          ) : null}
        </div>
        {showRight && !compact ? (
          <>
            <ResizeHandle direction="v" invert getSize={() => viewStore.get().panels.rightWidth} onResize={(rightWidth) => viewStore.setPanels({ rightWidth })} min={280} max={760} />
            <aside className="af-side right" aria-label="Inspector">
              <Inspector />
            </aside>
          </>
        ) : null}
        {compact && view.selectedId ? (
          <aside className="af-side right" aria-label="Inspector" style={{ position: 'absolute', inset: 0, zIndex: 20, borderLeft: 0 }}>
            <Inspector />
          </aside>
        ) : null}
      </div>
    </div>
  )
}
