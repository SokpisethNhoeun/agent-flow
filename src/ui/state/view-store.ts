// Presentation state only (never runtime truth): view mode, selection, filters, panels and node
// positions. Persisted per surface: the .agentflow document in the canvas editor, localStorage
// elsewhere. Switching views never touches agents or the worker.

export type ViewMode = 'hierarchy' | 'workflow'

/** `left: false` shows the sidebar as a narrow icon rail. `closedSections`: sidebar sections folded shut. */
export type PanelState = { left: boolean; right: boolean; bottom: boolean; leftWidth: number; rightWidth: number; bottomHeight: number; closedSections?: Record<string, boolean> }

export type Filters = {
  search: string
  runId: string | 'all'
  showFinished: boolean
  showIdle: boolean
  showToolCalls: boolean
  /** Default view: only agents with live evidence that are working, waiting or blocked. */
  activeOnly: boolean
  /** One project box, or all of them. */
  projectKey: string | 'all'
}

export type ViewState = {
  mode: ViewMode
  selectedId: string | null
  collapsed: Record<string, boolean>
  filters: Filters
  panels: PanelState
  bottomTab: 'timeline' | 'messages' | 'errors' | 'history'
  /** Saved node positions per layout (see layoutKey): flat and project-grouped layouts differ. */
  positions: Record<string, Record<string, { x: number; y: number }>>
  layoutRevision: number
  /** Group agents into a box per project (default). */
  groupByProject: boolean
  /** Sizes the person gave project boxes by resizing them. */
  boxSizes: Record<string, { width: number; height: number }>
}

export type PersistedView = Pick<ViewState, 'mode' | 'collapsed' | 'filters' | 'panels' | 'positions' | 'groupByProject' | 'boxSizes'>

/** Positions are saved per view mode and per grouping, since box-relative and flat coordinates differ. */
export function layoutKey(view: Pick<ViewState, 'mode' | 'groupByProject'>): string {
  return view.groupByProject ? `${view.mode}:projects` : view.mode
}

export type ViewPersistence = {
  load(): Promise<Partial<PersistedView> | null>
  save(view: PersistedView): void
}

export function defaultView(compact: boolean): ViewState {
  return {
    mode: 'hierarchy',
    selectedId: null,
    collapsed: {},
    filters: { search: '', runId: 'all', showFinished: true, showIdle: true, showToolCalls: false, activeOnly: true, projectKey: 'all' },
    panels: { left: !compact, right: !compact, bottom: !compact, leftWidth: 260, rightWidth: 380, bottomHeight: 220, closedSections: {} },
    bottomTab: 'timeline',
    positions: {},
    layoutRevision: 0,
    groupByProject: true,
    boxSizes: {}
  }
}

export class ViewStore {
  private state: ViewState
  private listeners = new Set<() => void>()
  private saveTimer: ReturnType<typeof setTimeout> | null = null

  constructor(
    compact: boolean,
    private readonly persistence: ViewPersistence | null
  ) {
    this.state = defaultView(compact)
  }

  async hydrate(): Promise<void> {
    const saved = await this.persistence?.load().catch(() => null)
    if (!saved) return
    this.state = {
      ...this.state,
      ...(saved.mode === 'hierarchy' || saved.mode === 'workflow' ? { mode: saved.mode } : {}),
      collapsed: saved.collapsed ?? this.state.collapsed,
      filters: { ...this.state.filters, ...(saved.filters ?? {}) },
      panels: { ...this.state.panels, ...(saved.panels ?? {}) },
      positions: saved.positions ?? {},
      groupByProject: saved.groupByProject ?? this.state.groupByProject,
      boxSizes: saved.boxSizes ?? {}
    }
    this.emit()
  }

  get = (): ViewState => this.state

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  set(partial: Partial<ViewState> | ((state: ViewState) => Partial<ViewState>)): void {
    const next = typeof partial === 'function' ? partial(this.state) : partial
    this.state = { ...this.state, ...next }
    this.emit()
    this.scheduleSave()
  }

  setFilters(partial: Partial<Filters>): void {
    this.set((s) => ({ filters: { ...s.filters, ...partial } }))
  }

  setPanels(partial: Partial<PanelState>): void {
    this.set((s) => ({ panels: { ...s.panels, ...partial } }))
  }

  /** `current` is what the node shows now (it may come from a default, not an explicit choice). */
  toggleCollapsed(id: string, current?: boolean): void {
    this.set((s) => ({ collapsed: { ...s.collapsed, [id]: !(current ?? s.collapsed[id] ?? false) } }))
  }

  savePositions(key: string, positions: Record<string, { x: number; y: number }>): void {
    this.set((s) => ({ positions: { ...s.positions, [key]: { ...(s.positions[key] ?? {}), ...positions } } }))
  }

  saveBoxSize(projectKey: string, size: { width: number; height: number }): void {
    this.set((s) => ({ boxSizes: { ...s.boxSizes, [projectKey]: size } }))
  }

  /** Auto-layout: forget manual positions for the current view. */
  resetLayout(): void {
    this.set((s) => ({ positions: { ...s.positions, [layoutKey(s)]: {} }, boxSizes: s.groupByProject ? {} : s.boxSizes, layoutRevision: s.layoutRevision + 1 }))
  }

  private emit(): void {
    for (const listener of this.listeners) listener()
  }

  private scheduleSave(): void {
    if (!this.persistence) return
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = setTimeout(() => {
      const { mode, collapsed, filters, panels, positions, groupByProject, boxSizes } = this.state
      this.persistence!.save({ mode, collapsed, filters, panels, positions, groupByProject, boxSizes })
    }, 600)
  }
}

export function localStoragePersistence(key: string): ViewPersistence {
  return {
    async load() {
      try {
        const raw = localStorage.getItem(key)
        return raw ? (JSON.parse(raw) as Partial<PersistedView>) : null
      } catch {
        return null
      }
    },
    save(view) {
      try {
        localStorage.setItem(key, JSON.stringify(view))
      } catch {
        // storage unavailable: positions just are not remembered
      }
    }
  }
}
