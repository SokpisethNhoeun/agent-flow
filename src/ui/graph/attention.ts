// What needs the person right now: blocked agents (permission prompts), open decision gates and
// recent failures. Only real reported state counts; nothing is guessed.
import type { FlowState } from '../../shared/model.ts'

export type AttentionKind = 'blocked' | 'gate' | 'failed-task' | 'failed-agent'

export type AttentionItem = {
  kind: AttentionKind
  /** The node / entity to select. */
  selectId: string
  title: string
  detail: string
  since: number | null
}

/** Failures older than this are history, not something to act on. */
export const RECENT_FAILURE_MS = 2 * 60 * 60 * 1000

const ORDER: Record<AttentionKind, number> = { blocked: 0, gate: 1, 'failed-task': 2, 'failed-agent': 3 }

export function attentionItems(state: FlowState, now: number): AttentionItem[] {
  const items: AttentionItem[] = []
  for (const agent of Object.values(state.agents)) {
    const name = agent.title ?? agent.id
    if (agent.live && agent.state === 'blocked') {
      items.push({ kind: 'blocked', selectId: agent.id, title: name, detail: 'Blocked: waiting for a permission or answer', since: agent.stateSince })
    } else if (agent.state === 'failed' && agent.role !== 'subagent') {
      const at = agent.endedAt ?? agent.stateSince ?? agent.lastSeenAt
      if (now - at <= RECENT_FAILURE_MS) items.push({ kind: 'failed-agent', selectId: agent.id, title: name, detail: 'Agent failed', since: at })
    }
  }
  for (const gate of Object.values(state.gates)) {
    if (gate.status !== 'pending') continue
    const task = gate.taskId ? state.tasks[gate.taskId] : undefined
    items.push({ kind: 'gate', selectId: task?.id ?? gate.id, title: task ? task.displayName ?? task.title : 'Decision', detail: gate.question ? `Decision: ${gate.question}` : 'Waiting for a decision', since: gate.createdAt })
  }
  for (const task of Object.values(state.tasks)) {
    if (task.state !== 'FAILED') continue
    const at = task.completedAt ?? task.createdAt
    if (at === null || now - at > RECENT_FAILURE_MS) continue
    // Failures in finished runs are history (the run's report shows them).
    if (state.runs[task.runId]?.state !== 'active') continue
    items.push({ kind: 'failed-task', selectId: task.id, title: task.displayName ?? task.title, detail: task.result?.message ? `Failed: ${task.result.message.split('\n')[0].slice(0, 120)}` : 'Task failed', since: at })
  }
  return items.sort((a, b) => ORDER[a.kind] - ORDER[b.kind] || (b.since ?? 0) - (a.since ?? 0))
}
