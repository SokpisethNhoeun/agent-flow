// What a screen reader should hear when the flow changes: things that need the person (urgent)
// and things that finished or failed (polite). Routine updates (tokens, last seen) say nothing.
import type { FlowState } from '../../shared/model.ts'

export type Announcement = { text: string; urgent: boolean }

const TASK_DONE = new Set(['DONE', 'MERGED', 'APPROVED'])

export function announcements(prev: FlowState, next: FlowState): Announcement[] {
  const out: Announcement[] = []
  for (const agent of Object.values(next.agents)) {
    const before = prev.agents[agent.id]
    if (!before || agent.role === 'subagent') continue
    const name = agent.title ?? agent.agent ?? 'An agent'
    if (agent.live && agent.state === 'blocked' && !(before.live && before.state === 'blocked')) out.push({ text: `${name} is blocked and needs you.`, urgent: true })
    else if (agent.state === 'failed' && before.state !== 'failed') out.push({ text: `${name} failed.`, urgent: false })
    else if (agent.state === 'done' && before.state !== 'done' && before.live) out.push({ text: `${name} finished.`, urgent: false })
  }
  for (const task of Object.values(next.tasks)) {
    const before = prev.tasks[task.id]
    if (!before || before.state === task.state) continue
    const name = task.displayName ?? task.title
    if (task.state === 'FAILED') out.push({ text: `Task ${name} failed.`, urgent: false })
    else if (TASK_DONE.has(task.state) && !TASK_DONE.has(before.state)) out.push({ text: `Task ${name} is done.`, urgent: false })
  }
  for (const gate of Object.values(next.gates)) {
    const before = prev.gates[gate.id]
    if (gate.status === 'pending' && before?.status !== 'pending') out.push({ text: `Decision needed${gate.question ? `: ${gate.question.slice(0, 120)}` : '.'}`, urgent: true })
  }
  return out
}

/** Many changes at once become one short summary instead of a long stream of messages. */
export function summarize(items: Announcement[], max = 3): string {
  if (items.length <= max) return items.map((item) => item.text).join(' ')
  const failed = items.filter((i) => i.text.endsWith('failed.')).length
  const needs = items.filter((i) => i.urgent).length
  const parts = [needs && `${needs} need you`, failed && `${failed} failed`, items.length - needs - failed && `${items.length - needs - failed} finished`].filter(Boolean)
  return `${items.length} updates: ${parts.join(', ')}.`
}
