// Asks the canvas to center a node (from the toolbar, explorer…) without coupling to React Flow.
const EVENT = 'agent-flow:focus-node'

export function requestFocus(nodeId: string): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(EVENT, { detail: nodeId }))
}

export function onFocusRequest(listener: (nodeId: string) => void): () => void {
  const handler = (event: Event) => listener((event as CustomEvent<string>).detail)
  window.addEventListener(EVENT, handler)
  return () => window.removeEventListener(EVENT, handler)
}
