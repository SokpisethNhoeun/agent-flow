// Which edges carry verified activity right now. Animation is driven only by these signals:
// a recent event that names both ends, or a live, working target agent/task.
import type { FlowEvent } from '../../shared/events.ts'

export const ACTIVE_WINDOW_MS = 15000

export type ActivityIndex = {
  /** "a→b" (and "b→a") pairs with a recent event, valued with the event seq for pulses. */
  pairs: Map<string, number>
  /** Entities with any recent event. */
  touched: Map<string, number>
}

export function buildActivity(events: readonly FlowEvent[], now: number): ActivityIndex {
  const pairs = new Map<string, number>()
  const touched = new Map<string, number>()
  // Events can arrive out of time order (history read from files), so scan them all; the
  // timeline is bounded, so this stays cheap.
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i]
    if (now - event.ts > ACTIVE_WINDOW_MS || event.ts > now + 5000) continue
    touched.set(event.entityId, Math.max(touched.get(event.entityId) ?? 0, event.seq))
    if (event.targetId) {
      touched.set(event.targetId, Math.max(touched.get(event.targetId) ?? 0, event.seq))
      pairs.set(`${event.entityId}→${event.targetId}`, Math.max(pairs.get(`${event.entityId}→${event.targetId}`) ?? 0, event.seq))
      pairs.set(`${event.targetId}→${event.entityId}`, Math.max(pairs.get(`${event.targetId}→${event.entityId}`) ?? 0, event.seq))
    }
  }
  return { pairs, touched }
}

export function pairActivity(index: ActivityIndex, a: string, b: string): number {
  return index.pairs.get(`${a}→${b}`) ?? 0
}
