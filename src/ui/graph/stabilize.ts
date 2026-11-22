// Keeps object identity for nodes and edges whose content did not change between rebuilds, so
// memoized node and edge components (and React Flow's own diffing) skip them entirely.

/** Structural equality for plain JSON-like values (no functions, no cycles). */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  if (Array.isArray(a)) {
    const other = b as unknown[]
    if (a.length !== other.length) return false
    for (let i = 0; i < a.length; i++) if (!deepEqual(a[i], other[i])) return false
    return true
  }
  const ka = Object.keys(a as object)
  const kb = Object.keys(b as object)
  if (ka.length !== kb.length) return false
  for (const key of ka) {
    if (!Object.prototype.hasOwnProperty.call(b, key)) return false
    if (!deepEqual((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key])) return false
  }
  return true
}

export type StableCache<T> = { byId: Map<string, T>; list: T[] }

export function emptyCache<T>(): StableCache<T> {
  return { byId: new Map(), list: [] }
}

/**
 * Returns `next` with every unchanged item replaced by its previous object, and the previous
 * array itself when nothing changed at all. The cache is updated in place.
 */
export function stabilize<T extends { id: string }>(cache: StableCache<T>, next: readonly T[]): T[] {
  const byId = new Map<string, T>()
  let same = next.length === cache.list.length
  const out = next.map((item, index) => {
    const previous = cache.byId.get(item.id)
    const kept = previous && deepEqual(previous, item) ? previous : item
    byId.set(item.id, kept)
    if (same && cache.list[index] !== kept) same = false
    return kept
  })
  cache.byId = byId
  if (same) return cache.list
  cache.list = out
  return out
}
