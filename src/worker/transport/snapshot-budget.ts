// Orca caps a panel request's answer at 1 MiB. Trim the least useful parts first until the
// snapshot fits: old timeline events, tool calls, message text, then long task text.
// The whole snapshot is serialized once; after that only the part a step changed is re-measured.
import type { FlowSnapshot } from '../../shared/events.ts'
import { truncate } from '../../shared/redact.ts'

export const PANEL_SNAPSHOT_BUDGET = 900 * 1024

type Part = 'events' | 'toolCalls' | 'messages' | 'tasks'

const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value))

const read = (s: FlowSnapshot, part: Part): unknown => (part === 'events' ? s.events : s.state[part])

const STEPS: { part: Part; apply: (s: FlowSnapshot) => FlowSnapshot }[] = [
  { part: 'events', apply: (s) => ({ ...s, events: s.events.slice(-300) }) },
  { part: 'toolCalls', apply: (s) => ({ ...s, state: { ...s.state, toolCalls: s.state.toolCalls.slice(-80) } }) },
  { part: 'messages', apply: (s) => ({ ...s, state: { ...s.state, messages: s.state.messages.slice(-120).map((m) => ({ ...m, body: m.body ? truncate(m.body, 200) : null })) } }) },
  {
    part: 'tasks',
    apply: (s) => ({
      ...s,
      state: {
        ...s.state,
        tasks: Object.fromEntries(
          Object.entries(s.state.tasks).map(([id, t]) => [id, { ...t, spec: t.spec ? truncate(t.spec, 300) : null, result: t.result ? { ...t.result, raw: null, message: t.result.message ? truncate(t.result.message, 400) : null } : null }])
        )
      }
    })
  },
  { part: 'events', apply: (s) => ({ ...s, events: s.events.slice(-80) }) }
]

export function fitSnapshot(snapshot: FlowSnapshot, budget = PANEL_SNAPSHOT_BUDGET): FlowSnapshot {
  let total = bytes(snapshot)
  if (total <= budget) return snapshot
  const sizes = new Map<Part, number>()
  const sizeOf = (s: FlowSnapshot, part: Part) => {
    if (!sizes.has(part)) sizes.set(part, bytes(read(s, part)))
    return sizes.get(part)!
  }
  let current = snapshot
  for (const step of STEPS) {
    const before = sizeOf(current, step.part)
    current = step.apply(current)
    const after = bytes(read(current, step.part))
    sizes.set(step.part, after)
    total += after - before
    if (total <= budget) return current
  }
  return current
}
