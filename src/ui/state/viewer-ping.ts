// Tells the worker this view is open and visible, so it keeps scanning at full speed.
// Hidden tabs and closed panels stop pinging, and the worker slows down by itself.
import { newRequestId } from '../../shared/commands.ts'
import type { Transport } from '../transport/types.ts'

export const VIEWER_PING_MS = 30_000

export function startViewerPing(transport: Transport): () => void {
  if (typeof document === 'undefined') return () => undefined
  const ping = () => {
    if (document.visibilityState !== 'visible') return
    void transport.command({ requestId: newRequestId(), kind: 'viewer.ping', params: {} })
  }
  const onVisibility = () => {
    if (document.visibilityState === 'visible') ping()
  }
  const timer = setInterval(ping, VIEWER_PING_MS)
  document.addEventListener('visibilitychange', onVisibility)
  return () => {
    clearInterval(timer)
    document.removeEventListener('visibilitychange', onVisibility)
  }
}
