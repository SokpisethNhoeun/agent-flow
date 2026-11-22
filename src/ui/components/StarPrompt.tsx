// "Enjoying Agent Flow? Star it on GitHub" — a small card, asked at most once in a while (the worker
// decides when: after real use, never twice in a row). Starring opens the repository page.
import { useEffect, useState } from 'react'
import { newRequestId } from '../../shared/commands.ts'
import { useApp, useFlowView } from '../state/app-context.tsx'
import { Icon } from './Icon.tsx'

type Answer = 'starred' | 'later' | 'never'

export function StarPrompt() {
  const { client } = useApp()
  const flow = useFlowView()
  const [url, setUrl] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    void client.transport.command({ requestId: newRequestId(), kind: 'star.visit', params: {} }).then((response) => {
      if (!alive || !response.ok) return
      const result = response.result as { show: boolean; url?: string }
      if (result.show && result.url) setUrl(result.url)
    })
    return () => {
      alive = false
    }
  }, [client])

  if (!url || flow.mode === 'replay') return null
  const answer = (value: Answer) => {
    setUrl(null)
    void client.transport.command({ requestId: newRequestId(), kind: 'star.answer', params: { answer: value } })
  }
  const star = async () => {
    if (client.transport.openExternal) await client.transport.openExternal(url).catch(() => undefined)
    else window.open(url, '_blank', 'noopener,noreferrer')
    answer('starred')
  }
  return (
    <div className="af-star" role="dialog" aria-labelledby="af-star-title" aria-describedby="af-star-text">
      <span className="af-star-icon" aria-hidden>
        <Icon name="starFilled" size={18} />
      </span>
      <div className="af-star-body">
        <b id="af-star-title">Enjoying Agent Flow?</b>
        <span id="af-star-text">A star on GitHub helps other Orca users find it.</span>
        <div className="af-star-actions">
          <button type="button" className="af-btn sm primary" onClick={() => void star()}>
            <Icon name="starFilled" size={13} /> Star on GitHub
          </button>
          <button type="button" className="af-btn sm ghost" onClick={() => answer('later')}>Later</button>
          <button type="button" className="af-btn sm ghost" onClick={() => answer('never')}>Don't ask again</button>
        </div>
      </div>
      <button type="button" className="af-btn ghost icon sm af-star-close" aria-label="Close (ask later)" onClick={() => answer('later')}>
        <Icon name="close" size={13} />
      </button>
    </div>
  )
}
