// Status colors as the current theme defines them (--af-running…), for places that need a plain
// color value instead of CSS (SVG arrowheads, the minimap). Re-read when light/dark changes.
import { useEffect, useState } from 'react'
import { STATUS_COLOR } from '../edges/FlowEdge.tsx'

const TOKEN: Record<string, string> = { running: 'running', waiting: 'waiting', ready: 'ready', idle: 'ready', unknown: 'ready', blocked: 'blocked', failed: 'failed', review: 'review', testing: 'review', done: 'done', cancelled: 'cancelled' }

function read(): Record<string, string> {
  if (typeof document === 'undefined') return STATUS_COLOR
  const style = getComputedStyle(document.documentElement)
  const out: Record<string, string> = {}
  for (const [status, token] of Object.entries(TOKEN)) out[status] = style.getPropertyValue(`--af-${token}`).trim() || STATUS_COLOR[status]
  return out
}

export function useStatusColors(): Record<string, string> {
  const [colors, setColors] = useState(read)
  useEffect(() => {
    const media = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null
    const update = () => setColors(read())
    media?.addEventListener('change', update)
    // Orca can switch theme by changing its --orca-* variables on the root element.
    const observer = new MutationObserver(update)
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style'] })
    return () => {
      media?.removeEventListener('change', update)
      observer.disconnect()
    }
  }, [])
  return colors
}
