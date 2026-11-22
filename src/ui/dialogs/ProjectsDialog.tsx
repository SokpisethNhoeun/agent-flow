// Name and color project boxes, and group folders with your own path rules.
import { useState } from 'react'
import { Dialog } from '../components/overlays.tsx'
import { Button, Field } from '../components/primitives.tsx'
import { globToRegExp } from '../graph/projects.ts'
import { useProjectList } from '../panels/ProjectPicker.tsx'
import { useApp, useFlowView } from '../state/app-context.tsx'

type Rule = { pattern: string; name: string }

export function ProjectsDialog({ onClose }: { onClose: () => void }) {
  const { runCommand } = useApp()
  const { state } = useFlowView()
  const projects = useProjectList()
  const [names, setNames] = useState<Record<string, string>>(() => ({ ...(state.labels.projectNames ?? {}) }))
  const [colors, setColors] = useState<Record<string, string>>(() => ({ ...(state.labels.projectColors ?? {}) }))
  const [rules, setRules] = useState<Rule[]>(() => Object.entries(state.labels.projectRules ?? {}).map(([pattern, name]) => ({ pattern, name })))
  const home = state.capabilities.homeDir
  const knownPaths = [...new Set(Object.values(state.agents).map((a) => a.worktreePath).filter((p): p is string => Boolean(p)))]

  const matches = (pattern: string) => {
    if (!pattern.trim()) return 0
    try {
      const re = globToRegExp(pattern, home)
      return knownPaths.filter((p) => re.test(p)).length
    } catch {
      return 0
    }
  }

  const save = async () => {
    const projectRules = Object.fromEntries(rules.filter((r) => r.pattern.trim() && r.name.trim()).map((r) => [r.pattern.trim(), r.name.trim()]))
    const projectNames = Object.fromEntries(Object.entries(names).filter(([, v]) => v.trim()).map(([k, v]) => [k, v.trim()]))
    // A rule's box is named by the rule; colors may be set for both.
    const response = await runCommand('labels.update', { projectNames, projectColors: colors, projectRules })
    if (response?.ok) onClose()
  }

  const ruleKeys = rules.filter((r) => r.name.trim()).map((r) => `rule:${r.name.trim()}`)
  const rows = [...projects.filter((p) => !p.key.startsWith('rule:')), ...ruleKeys.map((key) => ({ key, name: key.slice(5), live: 0, total: 0 }))]

  return (
    <Dialog
      title="Project boxes"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={() => void save()}>
            Save
          </Button>
        </>
      }
    >
      <div className="af-note">Agents are grouped by the project Orca reports for their worktree. Removed worktrees are matched by folder. Your path rules below win over that.</div>
      <div style={{ display: 'grid', gap: 8 }}>
        {rows.map((p) => (
          <div key={p.key} className="af-project-row">
            <input type="color" value={colors[p.key] ?? '#6366f1'} onChange={(e) => setColors({ ...colors, [p.key]: e.target.value })} aria-label={`Color for ${p.name}`} />
            {p.key.startsWith('rule:') ? (
              <span className="af-project-row-name">{p.name} <span className="af-chip">rule</span></span>
            ) : (
              <input className="af-input" value={names[p.key] ?? ''} placeholder={p.name} maxLength={60} onChange={(e) => setNames({ ...names, [p.key]: e.target.value })} aria-label={`Name for ${p.name}`} />
            )}
            <span className="af-muted" style={{ fontSize: 11, whiteSpace: 'nowrap' }}>{p.total ? `${p.total} agents` : ''}</span>
          </div>
        ))}
      </div>
      <Field label="Path rules: a folder or glob (~, *, **) → box name. Rules are checked top to bottom.">
        <div style={{ display: 'grid', gap: 6 }}>
          {rules.map((rule, i) => (
            <div key={i} className="af-rule-row">
              <input className="af-input af-mono" placeholder="~/Code/acme/**" value={rule.pattern} maxLength={300} onChange={(e) => setRules(rules.map((r, j) => (j === i ? { ...r, pattern: e.target.value } : r)))} aria-label="Path pattern" />
              <span className="af-muted">→</span>
              <input className="af-input" placeholder="Box name" value={rule.name} maxLength={60} onChange={(e) => setRules(rules.map((r, j) => (j === i ? { ...r, name: e.target.value } : r)))} aria-label="Box name" />
              <span className="af-muted" style={{ fontSize: 11, minWidth: 62 }}>{rule.pattern.trim() ? `${matches(rule.pattern)} match` : ''}</span>
              <Button size="sm" iconOnly variant="ghost" icon="close" aria-label="Remove rule" onClick={() => setRules(rules.filter((_, j) => j !== i))} />
            </div>
          ))}
          <div>
            <Button size="sm" icon="plus" onClick={() => setRules([...rules, { pattern: '', name: '' }])}>
              Add rule
            </Button>
          </div>
        </div>
      </Field>
    </Dialog>
  )
}
