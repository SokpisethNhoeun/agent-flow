// Screen-reader announcements of important changes (blocked, failed, finished, decisions needed).
// Two off-screen live regions: urgent ones interrupt, the rest wait their turn. Bursts are batched
// every 2 s into one short summary; replays and the first load say nothing.
import { useEffect, useRef, useState } from 'react'
import type { FlowState } from '../../shared/model.ts'
import { announcements, summarize, type Announcement } from '../graph/announcements.ts'
import { useFlowView } from '../state/app-context.tsx'

const BATCH_MS = 2000

export function LiveAnnouncer() {
  const flow = useFlowView()
  const previous = useRef<FlowState | null>(null)
  const queue = useRef<Announcement[]>([])
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [polite, setPolite] = useState('')
  const [urgent, setUrgent] = useState('')

  useEffect(() => {
    const prev = previous.current
    previous.current = flow.mode === 'live' && flow.loaded ? flow.state : null
    if (!prev || !previous.current) return
    const items = announcements(prev, flow.state)
    if (!items.length) return
    queue.current.push(...items)
    if (timer.current) return
    timer.current = setTimeout(() => {
      timer.current = null
      const batch = queue.current.splice(0)
      const pressing = batch.filter((item) => item.urgent)
      // Re-setting the same text would not be read again; clear first.
      if (pressing.length) setUrgent(summarize(pressing))
      const rest = batch.filter((item) => !item.urgent)
      if (rest.length) setPolite(summarize(rest))
    }, BATCH_MS)
  }, [flow.state, flow.mode, flow.loaded])

  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), [])
  useEffect(() => {
    if (!polite && !urgent) return
    const clear = setTimeout(() => {
      setPolite('')
      setUrgent('')
    }, 8000)
    return () => clearTimeout(clear)
  }, [polite, urgent])

  return (
    <>
      <div className="af-sr-only" role="status" aria-live="polite" aria-atomic="true">
        {polite}
      </div>
      <div className="af-sr-only" role="alert" aria-live="assertive" aria-atomic="true">
        {urgent}
      </div>
    </>
  )
}
