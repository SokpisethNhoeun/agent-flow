// The left sidebar folded into a narrow strip: one icon per section with its count. Clicking an
// icon opens the sidebar on that section; the top button just opens it.
import { Icon } from '../components/Icon.tsx'
import { Button } from '../components/primitives.tsx'
import { Tip } from '../components/ui/Controls.tsx'
import { useApp } from '../state/app-context.tsx'
import { revealSection, SECTIONS, useExplorerData } from './explorer-data.ts'

export function ExplorerRail() {
  const { viewStore } = useApp()
  const { counts } = useExplorerData()
  const open = (sectionId?: string) => {
    const closed = { ...(viewStore.get().panels.closedSections ?? {}) }
    if (sectionId) closed[sectionId] = false
    viewStore.setPanels({ left: true, closedSections: closed })
    if (sectionId) revealSection(sectionId)
  }
  return (
    <nav className="af-rail" aria-label="Explorer (collapsed)">
      <Button size="sm" iconOnly variant="ghost" icon="expandRight" title="Expand the sidebar" aria-label="Expand sidebar" onClick={() => open()} />
      <span className="af-rail-sep" aria-hidden />
      {SECTIONS.map((section) => {
        const count = counts[section.id]
        return (
          <Tip key={section.id} content={`${section.title}: ${count}`} side="right">
            <button type="button" className="af-btn ghost sm af-rail-item" aria-label={`${section.title}, ${count}. Open in sidebar`} onClick={() => open(section.id)}>
              <Icon name={section.icon} size={14} />
              <span className="af-rail-count" aria-hidden>
                {typeof count === 'string' ? parseInt(count, 10) : count}
              </span>
            </button>
          </Tip>
        )
      })}
    </nav>
  )
}
