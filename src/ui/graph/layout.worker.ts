// Layout worker: runs dagre off the main thread so big project boxes never freeze the canvas.
import { computeLayout, type LayoutInput } from './layout-engine.ts'

type Request = { id: number; input: LayoutInput }

self.onmessage = (event: MessageEvent<Request>) => {
  const { id, input } = event.data
  try {
    ;(self as unknown as Worker).postMessage({ id, positions: computeLayout(input) })
  } catch (error) {
    ;(self as unknown as Worker).postMessage({ id, error: String(error) })
  }
}
