// Starts the layout worker next to app.js. If the host refuses workers (or the worker fails),
// layouts quietly go back to the main thread: same result, only slower for huge boxes.
import type { AsyncLayouter } from './layout-cache.ts'
import type { LayoutPositions } from './layout-engine.ts'

const TIMEOUT_MS = 10_000

export function createWorkerLayouter(): AsyncLayouter | null {
  if (typeof Worker === 'undefined') return null
  let worker: Worker
  try {
    worker = new Worker(new URL('./layout-worker.js', import.meta.url), { type: 'module' })
  } catch {
    return null
  }
  let broken = false
  let nextId = 1
  const waiting = new Map<number, { resolve: (p: LayoutPositions) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>()
  const failAll = (message: string) => {
    broken = true
    for (const [, entry] of waiting) {
      clearTimeout(entry.timer)
      entry.reject(new Error(message))
    }
    waiting.clear()
  }
  worker.onerror = () => failAll('layout worker failed')
  worker.onmessage = (event: MessageEvent<{ id: number; positions?: LayoutPositions; error?: string }>) => {
    const entry = waiting.get(event.data.id)
    if (!entry) return
    waiting.delete(event.data.id)
    clearTimeout(entry.timer)
    if (event.data.positions) entry.resolve(event.data.positions)
    else entry.reject(new Error(event.data.error ?? 'layout failed'))
  }
  return (input) =>
    new Promise<LayoutPositions>((resolve, reject) => {
      if (broken) return reject(new Error('layout worker unavailable'))
      const id = nextId++
      const timer = setTimeout(() => {
        waiting.delete(id)
        reject(new Error('layout timed out'))
      }, TIMEOUT_MS)
      waiting.set(id, { resolve, reject, timer })
      worker.postMessage({ id, input })
    })
}
