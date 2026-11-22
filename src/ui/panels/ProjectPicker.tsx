// Toolbar: group into project boxes (default) and filter to one project.
import { useMemo } from 'react'
import { Segmented } from '../components/ui/Controls.tsx'
import { Select } from '../components/ui/Select.tsx'
import { OTHER_PROJECT, ProjectResolver } from '../graph/projects.ts'
import { useApp, useFlowView, useViewState } from '../state/app-context.tsx'

/** Projects that currently have agents, with their live counts. */
export function useProjectList(): { key: string; name: string; live: number; total: number }[] {
  const { state } = useFlowView()
  return useMemo(() => {
    const resolver = new ProjectResolver(state)
    const map = new Map<string, { key: string; name: string; live: number; total: number }>()
    for (const agent of Object.values(state.agents)) {
      if (agent.role === 'lead') continue
      const place = agent.worktreePath || agent.projectId ? agent : agent.parentId ? state.agents[agent.parentId] : undefined
      const info = resolver.resolve(place?.worktreePath, place?.repoRoot, place?.projectId)
      const row = map.get(info.key) ?? { key: info.key, name: info.name, live: 0, total: 0 }
      row.total++
      if (agent.live) row.live++
      map.set(info.key, row)
    }
    // Orca projects with no agents yet still appear, so they can be named and colored.
    for (const project of Object.values(state.projects ?? {})) {
      const info = resolver.resolve(project.path)
      if (!map.has(info.key)) map.set(info.key, { key: info.key, name: info.name, live: 0, total: 0 })
    }
    return [...map.values()].sort((a, b) => Number(a.key === OTHER_PROJECT) - Number(b.key === OTHER_PROJECT) || b.live - a.live || a.name.localeCompare(b.name))
  }, [state])
}

export function ProjectPicker() {
  const { viewStore, surface } = useApp()
  const view = useViewState()
  const projects = useProjectList()
  return (
    <>
      <Select
        ariaLabel="Project"
        value={view.filters.projectKey}
        onChange={(projectKey) => viewStore.setFilters({ projectKey })}
        style={{ maxWidth: surface === 'panel' ? 150 : 220 }}
        options={[
          { value: 'all', label: 'All projects' },
          ...projects.map((p) => ({ value: p.key, label: p.name, hint: p.total ? (p.live ? `${p.live} live of ${p.total}` : `${p.total} agent${p.total === 1 ? '' : 's'}`) : 'No agents yet', dot: p.live ? ('live' as const) : ('muted' as const) }))
        ]}
      />
      <Segmented
        ariaLabel="Grouping"
        value={view.groupByProject ? 'boxes' : 'flat'}
        onChange={(v) => viewStore.set({ groupByProject: v === 'boxes' })}
        options={[
          { value: 'boxes', label: 'Boxes', title: 'One box per project' },
          { value: 'flat', label: 'Flat', title: 'One graph without project boxes' }
        ]}
      />
    </>
  )
}
