// Images added to the message box (paste, drop or the attach button): previewed at once, uploaded
// to the worker in chunks (agent.attach), and sent by id with the message.
import { useCallback, useEffect, useRef, useState } from 'react'
import { newRequestId } from '../../shared/commands.ts'
import { useApp } from '../state/app-context.tsx'

export const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif']
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024
export const MAX_IMAGES = 5
/**
 * Base64 characters per request. Orca's panel frame refuses any single message over 66 560 bytes
 * (its "shared" lane, plugin-frame-guest-send-budget) and the dashboard caps bodies at 128 KiB, so
 * each piece is 48 000 characters, leaving room for the request around it.
 */
export const CHUNK = 48_000

export type AttachmentItem = { key: string; name: string; url: string; state: 'uploading' | 'ready' | 'error'; attachmentId?: string; error?: string }

function readBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ''))
    reader.onerror = () => reject(reader.error ?? new Error('Could not read the image.'))
    reader.readAsDataURL(file)
  })
}

export function useImageAttachments() {
  const { client } = useApp()
  const [items, setItems] = useState<AttachmentItem[]>([])
  const urls = useRef(new Set<string>())
  const patch = (key: string, change: Partial<AttachmentItem>) => setItems((list) => list.map((item) => (item.key === key ? { ...item, ...change } : item)))

  const upload = useCallback(
    async (key: string, file: File) => {
      try {
        const data = await readBase64(file)
        const uploadId = crypto.randomUUID()
        for (let offset = 0; ; offset += CHUNK) {
          const chunk = data.slice(offset, offset + CHUNK)
          const done = offset + CHUNK >= data.length
          const response = await client.transport.command({ requestId: newRequestId(), kind: 'agent.attach', params: { uploadId, mediaType: file.type, chunk, offset: String(offset), done } })
          if (!response.ok) throw new Error(response.error.message)
          if (done) {
            patch(key, { state: 'ready', attachmentId: (response.result as { attachmentId: string }).attachmentId })
            return
          }
        }
      } catch (error) {
        patch(key, { state: 'error', error: (error as Error).message })
      }
    },
    [client]
  )

  /** Adds images; returns a message for anything refused (wrong type, too big, too many). */
  const add = useCallback(
    (files: File[]): string | null => {
      const problems: string[] = []
      const accepted: AttachmentItem[] = []
      let room = MAX_IMAGES - items.length
      for (const file of files) {
        if (!IMAGE_TYPES.includes(file.type)) problems.push(`${file.name || 'That file'} is not a PNG, JPEG, WebP or GIF image.`)
        else if (file.size > MAX_IMAGE_BYTES) problems.push(`${file.name || 'That image'} is larger than 10 MB.`)
        else if (room <= 0) problems.push(`At most ${MAX_IMAGES} images per message.`)
        else {
          room--
          const url = URL.createObjectURL(file)
          urls.current.add(url)
          const item: AttachmentItem = { key: crypto.randomUUID(), name: file.name || 'Pasted image', url, state: 'uploading' }
          accepted.push(item)
          void upload(item.key, file)
        }
      }
      if (accepted.length) setItems((list) => [...list, ...accepted])
      return problems.length ? [...new Set(problems)].join(' ') : null
    },
    [items.length, upload]
  )

  const remove = useCallback((key: string) => {
    setItems((list) => {
      const item = list.find((i) => i.key === key)
      if (item) {
        URL.revokeObjectURL(item.url)
        urls.current.delete(item.url)
      }
      return list.filter((i) => i.key !== key)
    })
  }, [])

  const clear = useCallback(() => {
    setItems((list) => {
      for (const item of list) {
        URL.revokeObjectURL(item.url)
        urls.current.delete(item.url)
      }
      return []
    })
  }, [])

  useEffect(() => () => urls.current.forEach((url) => URL.revokeObjectURL(url)), [])

  return {
    items,
    add,
    remove,
    clear,
    readyIds: items.filter((i) => i.state === 'ready').map((i) => i.attachmentId!),
    uploading: items.some((i) => i.state === 'uploading'),
    failed: items.some((i) => i.state === 'error')
  }
}
