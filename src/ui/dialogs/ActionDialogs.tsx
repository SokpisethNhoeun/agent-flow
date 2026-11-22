// Forms for actions that need input. Each submits one validated command; the worker re-validates.
import { useState } from 'react'
import type { CommandKind } from '../../shared/commands.ts'
import { Dialog } from '../components/overlays.tsx'
import { Button, Field } from '../components/primitives.tsx'
import { agentKindLabel } from '../graph/status.ts'
import { useApp, useFlowView } from '../state/app-context.tsx'
import { AgentLogo } from '../components/AgentLogo.tsx'
import { MultiSelect } from '../components/ui/Menu.tsx'
import { Select, type SelectOption } from '../components/ui/Select.tsx'

const agentOptions = (agents: string[]): SelectOption[] => agents.map((a) => ({ value: a, label: agentKindLabel(a), icon: <AgentLogo agent={a} size={14} /> }))

const AGENTS = ['claude', 'codex', 'antigravity', 'gemini', 'opencode', 'cursor']
const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max']

function CoordinatorNote({ kind }: { kind: CommandKind }) {
  const { state } = useFlowView()
  const cap = state.capabilities.commands[kind]
  if (!cap || cap.mode !== 'coordinator') return null
  return <div className="af-note warn">{cap.reason}</div>
}

function Footer({ onClose, onSubmit, label, disabled }: { onClose: () => void; onSubmit: () => void; label: string; disabled?: boolean }) {
  return (
    <>
      <Button onClick={onClose}>Cancel</Button>
      <Button variant="primary" onClick={onSubmit} disabled={disabled}>
        {label}
      </Button>
    </>
  )
}

export function RetryDialog({ taskId, runId, mode, onClose }: { taskId: string; runId: string; mode: 'retry' | 'dispatch'; onClose: () => void }) {
  const { runCommand } = useApp()
  const { state } = useFlowView()
  const task = state.tasks[taskId]
  const last = task?.assigneeAgentId ? state.agents[task.assigneeAgentId] : undefined
  const [agent, setAgent] = useState(last?.agent ?? 'claude')
  const [model, setModel] = useState(last?.model ?? '')
  const [effort, setEffort] = useState(last?.effort ?? '')
  const [worktree, setWorktree] = useState('new-child')
  const kind: CommandKind = mode === 'retry' ? 'task.retry' : 'task.dispatch'
  const submit = async () => {
    const response = await runCommand(kind, { taskId, runId, agent, ...(model ? { model } : {}), ...(model && effort ? { effort } : {}), worktree })
    if (response) onClose()
  }
  return (
    <Dialog title={`${mode === 'retry' ? 'Retry' : 'Dispatch'}: ${task?.displayName ?? task?.title ?? taskId}`} onClose={onClose} footer={<Footer onClose={onClose} onSubmit={submit} label={mode === 'retry' ? 'Retry' : 'Dispatch'} />}>
      <CoordinatorNote kind={kind} />
      <Field label="Agent">
        <Select ariaLabel="Agent" value={agent} onChange={setAgent} options={agentOptions([...new Set([agent, ...AGENTS])])} />
      </Field>
      <Field label="Model id (optional, e.g. claude-opus-5-5). Orca checks it is available.">
        <input className="af-input" value={model} onChange={(e) => setModel(e.target.value.trim())} placeholder="Agent default" />
      </Field>
      <Field label="Effort (needs a model)">
        <Select ariaLabel="Effort" value={effort} onChange={setEffort} disabled={!model} options={[{ value: '', label: 'Default' }, ...EFFORTS.map((e) => ({ value: e, label: e }))]} />
      </Field>
      <Field label="Worktree">
        <Select
          ariaLabel="Worktree"
          value={worktree}
          onChange={setWorktree}
          options={[
            { value: 'new-child', label: 'New child worktree', hint: 'Isolated branch for this attempt' },
            { value: 'current', label: 'Coordinator’s worktree', hint: 'Works in the same checkout' }
          ]}
        />
      </Field>
    </Dialog>
  )
}

export function TaskDialog({ runId, deps, onClose }: { runId: string; deps: string[]; onClose: () => void }) {
  const { runCommand } = useApp()
  const { state } = useFlowView()
  const [title, setTitle] = useState('')
  const [spec, setSpec] = useState('')
  const [selectedDeps, setSelectedDeps] = useState<string[]>(deps)
  const runTasks = Object.values(state.tasks).filter((task) => task.runId === runId)
  const submit = async () => {
    const response = await runCommand('task.create', { runId, title, spec, deps: selectedDeps })
    if (response) onClose()
  }
  return (
    <Dialog title="New task" onClose={onClose} footer={<Footer onClose={onClose} onSubmit={submit} label="Create task" disabled={!title.trim() || !spec.trim()} />}>
      <CoordinatorNote kind="task.create" />
      <Field label="Title">
        <input className="af-input" value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} />
      </Field>
      <Field label="Spec and acceptance criteria">
        <textarea className="af-textarea" rows={8} value={spec} maxLength={60000} onChange={(e) => setSpec(e.target.value)} />
      </Field>
      <Field label="Depends on">
        <MultiSelect ariaLabel="Depends on" placeholder="No dependencies" values={selectedDeps} onChange={setSelectedDeps} options={runTasks.map((task) => ({ value: task.id, label: task.displayName ?? task.title }))} />
      </Field>
    </Dialog>
  )
}

export function LaunchDialog({ workspaceId, onClose }: { workspaceId: string; onClose: () => void }) {
  const { runCommand } = useApp()
  const [agent, setAgent] = useState('claude')
  const [prompt, setPrompt] = useState('')
  const submit = async () => {
    const response = await runCommand('agent.launch', { workspaceId, agent, ...(prompt.trim() ? { prompt } : {}) })
    if (response?.ok) onClose()
  }
  return (
    <Dialog title="Launch agent" onClose={onClose} footer={<Footer onClose={onClose} onSubmit={submit} label="Launch" />}>
      <div className="af-note">Orca starts the agent with your usual settings and the account Orca has selected for it.</div>
      <Field label="Agent">
        <Select ariaLabel="Agent" value={agent} onChange={setAgent} options={agentOptions(AGENTS)} />
      </Field>
      <Field label="First prompt (optional)">
        <textarea className="af-textarea" rows={5} value={prompt} onChange={(e) => setPrompt(e.target.value)} />
      </Field>
    </Dialog>
  )
}

export function MessageDialog({ runId, to, onClose }: { runId: string; to: string; onClose: () => void }) {
  const { runCommand } = useApp()
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const submit = async () => {
    const response = await runCommand('message.send', { runId, to, subject, body })
    if (response) onClose()
  }
  return (
    <Dialog title={`Message ${to}`} onClose={onClose} footer={<Footer onClose={onClose} onSubmit={submit} label="Send" disabled={!subject.trim() || !body.trim()} />}>
      <CoordinatorNote kind="message.send" />
      <Field label="Subject">
        <input className="af-input" value={subject} maxLength={200} onChange={(e) => setSubject(e.target.value)} />
      </Field>
      <Field label="Message">
        <textarea className="af-textarea" rows={6} value={body} onChange={(e) => setBody(e.target.value)} />
      </Field>
    </Dialog>
  )
}

export function GateDialog({ gateId, runId, onClose }: { gateId: string; runId: string; onClose: () => void }) {
  const { runCommand } = useApp()
  const { state } = useFlowView()
  const gate = state.gates[gateId]
  const [resolution, setResolution] = useState('')
  const submit = async () => {
    const response = await runCommand('gate.resolve', { gateId, runId, resolution })
    if (response) onClose()
  }
  return (
    <Dialog title="Resolve decision gate" onClose={onClose} footer={<Footer onClose={onClose} onSubmit={submit} label="Resolve" disabled={!resolution.trim()} />}>
      <CoordinatorNote kind="gate.resolve" />
      <div className="af-pre">{gate?.question ?? gateId}</div>
      <Field label="Resolution">
        <textarea className="af-textarea" rows={4} value={resolution} onChange={(e) => setResolution(e.target.value)} />
      </Field>
    </Dialog>
  )
}

export function LabelsDialog({ onClose }: { onClose: () => void }) {
  const { runCommand } = useApp()
  const { state } = useFlowView()
  const [teams, setTeams] = useState<Record<string, string>>(() => ({ ...state.labels.accountTeams }))
  const [roles, setRoles] = useState(() => Object.entries(state.labels.agentRoles).map(([k, v]) => `${k} = ${v}`).join('\n'))
  const accounts = Object.values(state.accounts)
  const submit = async () => {
    const agentRoles: Record<string, string> = {}
    for (const line of roles.split('\n')) {
      const [key, ...rest] = line.split('=')
      if (key?.trim() && rest.join('=').trim()) agentRoles[key.trim()] = rest.join('=').trim()
    }
    const accountTeams = Object.fromEntries(Object.entries(teams).filter(([, v]) => v.trim()).map(([k, v]) => [k, v.trim()]))
    const response = await runCommand('labels.update', { accountTeams, agentRoles })
    if (response?.ok) onClose()
  }
  return (
    <Dialog title="Team and role labels" onClose={onClose} footer={<Footer onClose={onClose} onSubmit={submit} label="Save" />}>
      <div className="af-note">Optional names shown on the graph. Accounts come from Orca’s account list; nothing is required for the graph to work.</div>
      {accounts.length ? (
        accounts.map((account) => (
          <Field key={account.id} label={`${account.provider} · ${account.email ?? account.id}${account.active ? ' (active)' : ''}`}>
            <input className="af-input" placeholder="Team name, e.g. Team A" value={teams[account.id] ?? ''} maxLength={60} onChange={(e) => setTeams({ ...teams, [account.id]: e.target.value })} />
          </Field>
        ))
      ) : (
        <div className="af-muted">No managed accounts reported by Orca.</div>
      )}
      <Field label="Role labels: one per line, “model id, agent kind or worker name = label” (e.g. gpt-6.1-sol = Plan reviewer)">
        <textarea className="af-textarea" rows={4} value={roles} onChange={(e) => setRoles(e.target.value)} />
      </Field>
    </Dialog>
  )
}
