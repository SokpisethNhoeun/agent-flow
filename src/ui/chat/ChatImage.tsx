// An image from the transcript: fetched on demand in chunks (Orca caps each panel answer at
// 1 MiB), shown as a thumbnail, full size on click.
import { createContext, memo, useContext, useEffect, useState } from 'react'
import { newRequestId } from '../../shared/commands.ts'
import { Dialog } from '../components/overlays.tsx'
import { useApp } from '../state/app-context.tsx'
import type { ImageRef } from './conversation-to-thread.ts'

export const ChatAgentContext = createContext<string | null>(null)

const cache = new Map<string, Promise<string>>()

function useImageUrl(agentId: string | null, image: ImageRef): { url: string | null; error: string | null } {
  const { client } = useApp()
  const [state, setState] = useState<{ url: string | null; error: string | null }>({ url: null, error: null })
  useEffect(() => {
    if (!agentId) return
    const key = `${agentId}|${image.ref}`
    let promise = cache.get(key)
    if (!promise) {
      promise = (async () => {
        let data = ''
        let total = Infinity
        while (data.length < total) {
          const response = await client.transport.command({ requestId: newRequestId(), kind: 'agent.image', params: { agentId, ref: image.ref, offset: String(data.length) } })
          if (!response.ok) throw new Error(response.error.message)
          const part = response.result as { mediaType: string; total: number; chunk: string }
          total = part.total
          if (!part.chunk) break
          data += part.chunk
        }
        return `data:${image.mediaType};base64,${data}`
      })()
      cache.set(key, promise)
      if (cache.size > 60) cache.delete(cache.keys().next().value as string)
    }
    let alive = true
    promise.then(
      (url) => alive && setState({ url, error: null }),
      (error: Error) => {
        cache.delete(key)
        if (alive) setState({ url: null, error: error.message })
      }
    )
    return () => {
      alive = false
    }
  }, [agentId, image.ref, image.mediaType, client])
  return state
}

export const ChatImage = memo(function ChatImage({ data }: { data: ImageRef }) {
  const agentId = useContext(ChatAgentContext)
  const { url, error } = useImageUrl(agentId, data)
  const [open, setOpen] = useState(false)
  const size = data.bytes > 1024 * 1024 ? `${(data.bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(data.bytes / 1024))} KB`
  if (error) return <div className="af-chat-image af-chat-image-missing">Image unavailable: {error}</div>
  return (
    <>
      <button className="af-chat-image" onClick={() => url && setOpen(true)} title={`Open image (${size})`} aria-label="Open image" disabled={!url}>
        {url ? <img src={url} alt="" loading="lazy" /> : <span className="af-chat-image-loading">Loading image… {size}</span>}
      </button>
      {open && url ? (
        <Dialog title="Image" onClose={() => setOpen(false)}>
          <img src={url} alt="" className="af-chat-image-full" />
        </Dialog>
      ) : null}
    </>
  )
})
