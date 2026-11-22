// Which project box a path belongs to. Order: the person's path rules, Orca's project for that
// worktree, the project's root folder, the folder its other worktrees live in, else "Other".
import type { FlowState } from '../../shared/model.ts'

export const OTHER_PROJECT = 'project:other'

export type ProjectInfo = { key: string; name: string; path: string | null; color: string | null; source: 'rule' | 'orca' | 'path' | 'other' }

/** Glob with `*` (one segment), `**` (any depth) and a leading `~`. */
export function globToRegExp(pattern: string, home: string | null): RegExp {
  let p = pattern.trim()
  if (p.startsWith('~') && home) p = home.replace(/\/$/, '') + p.slice(1)
  const escaped = p.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*/g, '\u0000').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]').replace(/\u0000/g, '.*')
  // A rule for a folder also matches everything inside it.
  return new RegExp(`^${escaped}(/.*)?$`)
}

function parent(path: string): string {
  const i = path.replace(/\/+$/, '').lastIndexOf('/')
  return i > 0 ? path.slice(0, i) : path
}

export class ProjectResolver {
  private rules: { re: RegExp; name: string }[]
  private worktreeProject = new Map<string, string>()
  private roots: { path: string; id: string; catchAll: boolean }[]
  private worktreeParents = new Map<string, string>()
  private cache = new Map<string, ProjectInfo>()
  /** Folders that hold Orca's worktrees as `<root>/<project name>/<worktree>`. */
  private workspaceRoots = new Set<string>()
  private projectByName = new Map<string, string>()

  constructor(private readonly state: FlowState) {
    const home = state.capabilities.homeDir
    this.rules = Object.entries(state.labels.projectRules ?? {})
      .filter(([pattern, name]) => pattern.trim() && name.trim())
      .map(([pattern, name]) => ({ re: globToRegExp(pattern, home), name: name.trim() }))
    const projects = Object.values(state.projects ?? {})
    const byName = new Map(projects.map((p) => [p.name, p.id]))
    for (const w of Object.values(state.worktrees)) {
      const id = (w.projectId && state.projects?.[w.projectId] ? w.projectId : null) ?? (w.project ? byName.get(w.project) ?? null : null)
      if (!id) continue
      this.worktreeProject.set(w.path, id)
      // Orca keeps a project's worktrees side by side; a removed one still sits in that folder.
      if (w.path !== state.projects?.[id]?.path) {
        this.worktreeParents.set(parent(w.path), id)
        const name = state.projects?.[id]?.name
        if (name && parent(w.path).endsWith('/' + name)) this.workspaceRoots.add(parent(parent(w.path)))
      }
    }
    // A project rooted at the home folder (or /) would swallow everything below it: it only
    // matches agents working directly in it.
    const homeRoot = (home ?? '').replace(/\/+$/, '')
    for (const p of projects) this.projectByName.set(p.name, p.id)
    this.roots = projects
      .map((p) => {
        const path = p.path.replace(/\/+$/, '')
        return { path, id: p.id, catchAll: path === '' || path === homeRoot }
      })
      .sort((a, b) => b.path.length - a.path.length)
  }

  /** `repoRoot` (from the worktree's .git pointer) gives an exact match when known. */
  resolve(path: string | null | undefined, repoRoot?: string | null, projectId?: string | null): ProjectInfo {
    const key = `${path ?? ''}\u0000${repoRoot ?? ''}\u0000${projectId ?? ''}`
    const hit = this.cache.get(key)
    if (hit) return hit
    const info = this.compute(path ?? null, repoRoot ?? null, projectId ?? null)
    this.cache.set(key, info)
    return info
  }

  /** `<workspaces root>/<project name>/<worktree>` still names the project after the worktree is removed. */
  private byWorkspacesConvention(path: string): string | undefined {
    for (const root of this.workspaceRoots) {
      if (!path.startsWith(root + '/')) continue
      const name = path.slice(root.length + 1).split('/')[0]
      const id = this.projectByName.get(name)
      if (id) return id
    }
    return undefined
  }

  private compute(path: string | null, repoRoot: string | null, projectId: string | null): ProjectInfo {
    const labels = this.state.labels
    const decorate = (info: ProjectInfo): ProjectInfo => ({ ...info, name: labels.projectNames?.[info.key] || info.name, color: safeColor(labels.projectColors?.[info.key]) })
    if (!path && projectId && this.state.projects?.[projectId]) {
      const p = this.state.projects[projectId]
      return decorate({ key: `project:${projectId}`, name: p.name, path: p.path, color: null, source: 'orca' })
    }
    if (path) {
      for (const rule of this.rules) if (rule.re.test(path)) return decorate({ key: `rule:${rule.name}`, name: rule.name, path: null, color: null, source: 'rule' })
      const id =
        (projectId && this.state.projects?.[projectId] ? projectId : undefined) ??
        this.worktreeProject.get(path) ??
        (repoRoot ? this.roots.find((r) => r.path === repoRoot.replace(/\/+$/, ''))?.id : undefined) ??
        this.roots.find((r) => path === r.path || (!r.catchAll && path.startsWith(r.path + '/')))?.id ??
        this.worktreeParents.get(parent(path)) ??
        this.byWorkspacesConvention(path)
      if (id) {
        const p = this.state.projects[id]
        return decorate({ key: `project:${id}`, name: p?.name ?? id, path: p?.path ?? null, color: null, source: this.worktreeProject.has(path) ? 'orca' : 'path' })
      }
    }
    return decorate({ key: OTHER_PROJECT, name: 'Other', path: null, color: null, source: 'other' })
  }
}

export function safeColor(value: string | undefined): string | null {
  return value && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(value) ? value : null
}
