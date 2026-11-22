// What the left sidebar lists, shared by the full sidebar and its collapsed icon rail.
import { useMemo } from 'react'
import type { AgentRecord } from '../../shared/model.ts'
import type { IconName } from '../components/Icon.tsx'
import { isActiveAgent, visibleTasks } from '../graph/visibility.ts'
import { useFlowView, useViewState } from '../state/app-context.tsx'
import { useProjectList } from './ProjectPicker.tsx'

/** Sidebar sections in order, with the icon the collapsed rail shows for each. */
export const SECTIONS: { id: string; title: string; icon: IconName }[] = [
  { id: 'projects', title: 'Projects', icon: 'folder' },
  { id: 'runs', title: 'Runs', icon: 'play' },
  { id: 'agents', title: 'Agents', icon: 'bot' },
  { id: 'subagents', title: 'Subagents', icon: 'spark' },
  { id: 'tasks', title: 'Tasks', icon: 'task' },
  { id: 'accounts', title: 'Accounts', icon: 'account' },
  { id: 'models', title: 'Models in use', icon: 'cpu' }
]

export function useExplorerData() {
  const { state } = useFlowView()
  const view = useViewState()
  const projects = useProjectList()
  // Follows the Active/All toggle, like the canvas.
  const agents = useMemo(() => Object.values(state.agents).filter((a) => a.role !== 'lead' && (view.filters.runId === 'all' || a.runId === view.filters.runId) && (!view.filters.activeOnly || isActiveAgent(a))), [state.agents, view.filters.runId, view.filters.activeOnly])
  const live = agents.filter((a) => a.live)
  const subagents = agents.filter((a) => a.role === 'subagent')
  const teams = useMemo(() => {
    const map = new Map<string, AgentRecord[]>()
    for (const agent of agents) {
      if (agent.role === 'subagent') continue
      const key = (agent.account?.accountId && state.labels.accountTeams[agent.account.accountId]) || agent.account?.label || 'Account unknown'
      map.set(key, [...(map.get(key) ?? []), agent])
    }
    return [...map.entries()].sort((a, b) => b[1].filter((x) => x.live).length - a[1].filter((x) => x.live).length)
  }, [agents, state.labels.accountTeams])
  const tasks = visibleTasks(state, view.filters)
  const runs = Object.values(state.runs).sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0))
  const models = useMemo(() => {
    const map = new Map<string, number>()
    for (const agent of agents) if (agent.model) map.set(agent.model, (map.get(agent.model) ?? 0) + (agent.live ? 1 : 0))
    return [...map.entries()]
  }, [agents])
  const accounts = Object.values(state.accounts)
  /** The count each section shows (the rail shows the same numbers). */
  const counts: Record<string, number | string> = {
    projects: projects.length,
    runs: runs.length,
    agents: live.length ? `${live.length} live` : agents.length,
    subagents: subagents.length,
    tasks: tasks.length,
    accounts: accounts.length,
    models: models.length
  }
  return { projects, agents, live, subagents, teams, tasks, runs, models, accounts, counts }
}

/** Opens the full sidebar on one section and scrolls it into view (from the rail). */
export function revealSection(id: string): void {
  requestAnimationFrame(() => document.getElementById(`af-section-${id}`)?.scrollIntoView({ block: 'start', behavior: 'smooth' }))
}
