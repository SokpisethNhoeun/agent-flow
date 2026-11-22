// Animation budget: honours prefers-reduced-motion and caps how many edges animate at once so
// large graphs stay smooth and never slow Orca's agents down.
import { createContext } from 'react'

export const MAX_ANIMATED_EDGES = 150

export type Motion = { enabled: boolean; allow: (edgeId: string) => boolean }

export const MotionContext = createContext<Motion>({ enabled: true, allow: () => true })

export function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch {
    return false
  }
}

export function createMotion(activeEdgeIds: string[], reduced: boolean): Motion {
  const allowed = new Set(activeEdgeIds.slice(0, MAX_ANIMATED_EDGES))
  return { enabled: !reduced, allow: (id) => allowed.has(id) }
}
