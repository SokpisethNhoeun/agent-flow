// Reads a Claude Code transcript (.jsonl) into the inspector's conversation shape. Only the tail
// of large files is read; every text is redacted before it leaves the worker.
import { open, stat } from 'node:fs/promises'
import { redactAndTruncate } from '../../shared/redact.ts'
import type { AgentOutput, ConversationBlock, ConversationMessage, ImageRef } from './transcript.ts'

/** Growing read windows from the end of the transcript. */
const READ_WINDOWS = [3 * 1024 * 1024, 12 * 1024 * 1024, 48 * 1024 * 1024]
const IMAGE_SCAN_BYTES = 24 * 1024 * 1024
const KEEP_MESSAGES = 160
const TEXT_LIMIT = 4000
const TOOL_LIMIT = 1500

/** What was last read from a transcript's tail, so the next poll reads only what was appended. */
type Tail = { size: number; mtimeMs: number; end: number; messages: ConversationMessage[]; truncated: boolean; output: AgentOutput }
const tails = new Map<string, Tail>()
const MAX_TAILS = 24

function remember(path: string, tail: Tail): AgentOutput {
  tails.delete(path)
  tails.set(path, tail)
  if (tails.size > MAX_TAILS) tails.delete(tails.keys().next().value as string)
  return tail.output
}

function conversation(messages: ConversationMessage[], truncated: boolean): AgentOutput {
  return { kind: 'conversation', source: 'claude transcript', provider: 'claude', messages, truncated }
}

/** Forgets cached tails (tests). */
export function clearTranscriptCache(): void {
  tails.clear()
  images.clear()
  imageBytes = 0
}

/**
 * The newest messages, or with `beforeId` the batch just before that message. Reads a growing
 * window from the end of the file only as far back as needed (the file can be huge). Polling the
 * newest messages again reads only the bytes appended since the last call, and nothing at all
 * (the same answer object) when the file did not change.
 */
export async function readClaudeTranscript(path: string, options: { beforeId?: string } = {}): Promise<AgentOutput | null> {
  let info: { size: number; mtimeMs: number }
  try {
    info = await stat(path)
  } catch {
    tails.delete(path)
    return null
  }
  const { size, mtimeMs } = info
  if (!options.beforeId) {
    const tail = tails.get(path)
    if (tail && tail.size === size && tail.mtimeMs === mtimeMs) return tail.output
    if (tail && size > tail.size && size >= tail.end) {
      const read = await readMessages(path, tail.end, size, false)
      if (!read.messages.length) return remember(path, { ...tail, size, mtimeMs, end: read.end })
      const all = [...tail.messages, ...read.messages]
      const messages = all.slice(-KEEP_MESSAGES)
      const truncated = tail.truncated || all.length > messages.length
      return remember(path, { size, mtimeMs, end: read.end, messages, truncated, output: conversation(messages, truncated) })
    }
  }
  for (const window of READ_WINDOWS) {
    const start = Math.max(0, size - window)
    const read = await readMessages(path, start, size, start > 0)
    const messages = read.messages
    let end = messages.length
    if (options.beforeId) {
      end = messages.findIndex((m) => m.id === options.beforeId)
      // Not in this window yet (or the cut line hid it): read further back.
      if (end < 0) {
        if (start === 0) return conversation([], false)
        continue
      }
    }
    const from = Math.max(0, end - KEEP_MESSAGES)
    // Not enough older messages in this window and the file goes further back: widen it.
    if (from === 0 && start > 0 && end < KEEP_MESSAGES && window !== READ_WINDOWS[READ_WINDOWS.length - 1]) continue
    const kept = messages.slice(from, end)
    const truncated = from > 0 || start > 0
    if (options.beforeId) return conversation(kept, truncated)
    return remember(path, { size, mtimeMs, end: read.end, messages: kept, truncated, output: conversation(kept, truncated) })
  }
  return null
}

/**
 * Messages in [start, size). `end` is where the next incremental read must start: just after the
 * last complete line (a trailing line that is not valid JSON yet is read again next time).
 */
async function readMessages(path: string, start: number, size: number, firstLineCut: boolean): Promise<{ messages: ConversationMessage[]; end: number }> {
  const handle = await open(path, 'r')
  const buffer = Buffer.alloc(size - start)
  try {
    await handle.read(buffer, 0, buffer.length, start)
  } finally {
    await handle.close()
  }
  const lastNewline = buffer.lastIndexOf(0x0a)
  const lines = buffer.toString('utf8', 0, lastNewline + 1).split('\n')
  if (firstLineCut) lines.shift() // the first line may be cut
  const messages: ConversationMessage[] = []
  const take = (line: string): boolean => {
    if (!line.trim()) return true
    try {
      const message = toMessage(JSON.parse(line) as Record<string, unknown>)
      if (message) messages.push(message)
      return true
    } catch {
      return false // partial line
    }
  }
  for (const line of lines) take(line)
  let end = start + lastNewline + 1
  // A complete last entry without its newline yet still counts.
  const rest = buffer.toString('utf8', lastNewline + 1)
  if (rest.trim() && !(firstLineCut && lastNewline < 0) && take(rest)) end = size
  return { messages, end }
}

export function toMessage(entry: Record<string, unknown>): ConversationMessage | null {
  if (entry.type !== 'user' && entry.type !== 'assistant') return null
  const message = entry.message as { role?: string; content?: unknown } | undefined
  if (!message) return null
  const blocks: ConversationBlock[] = []
  const content = message.content
  if (typeof content === 'string') blocks.push({ type: 'text', text: redactAndTruncate(content, TEXT_LIMIT) })
  else if (Array.isArray(content)) {
    ;(content as Record<string, unknown>[]).forEach((raw, index) => {
      switch (raw?.type) {
        case 'image': {
          const image = imageRef(raw, `${entry.uuid}|${index}`)
          if (image) blocks.push({ type: 'image', image })
          break
        }
        case 'text':
          if (typeof raw.text === 'string' && raw.text.trim()) blocks.push({ type: 'text', text: redactAndTruncate(raw.text, TEXT_LIMIT) })
          break
        case 'thinking':
          if (typeof raw.thinking === 'string' && raw.thinking.trim()) blocks.push({ type: 'thinking', text: redactAndTruncate(raw.thinking, TEXT_LIMIT) })
          break
        case 'tool_use':
          blocks.push({ type: 'tool-call', name: String(raw.name ?? 'tool'), input: redactAndTruncate(JSON.stringify(raw.input ?? {}), TOOL_LIMIT) })
          break
        case 'tool_result': {
          const parts = Array.isArray(raw.content) ? (raw.content as Record<string, unknown>[]) : null
          const out = typeof raw.content === 'string' ? raw.content : parts ? parts.map((c) => (typeof c?.text === 'string' ? c.text : '')).filter(Boolean).join('\n') : JSON.stringify(raw.content ?? '')
          // Screenshots and other images a tool returned.
          const images = parts ? parts.map((c, j) => (c?.type === 'image' ? imageRef(c, `${entry.uuid}|${index}|${j}`) : null)).filter((x): x is ImageRef => Boolean(x)) : []
          blocks.push({ type: 'tool-result', output: redactAndTruncate(out, TOOL_LIMIT), isError: raw.is_error === true, ...(images.length ? { images } : {}) })
          break
        }
      }
    })
  }
  if (!blocks.length) return null
  const ts = typeof entry.timestamp === 'string' ? Date.parse(entry.timestamp) : NaN
  const rawModel = (message as { model?: unknown }).model
  const model = entry.type === 'assistant' && typeof rawModel === 'string' && rawModel !== '<synthetic>' ? rawModel : null
  const effort = typeof entry.perTurnEffort === 'string' ? entry.perTurnEffort : typeof entry.effort === 'string' ? entry.effort : null
  return { id: String(entry.uuid ?? Math.random()), role: message.role ?? String(entry.type), ts: Number.isFinite(ts) ? ts : null, blocks, ...(model ? { model, effort } : {}) }
}

const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp'])

function imageRef(raw: Record<string, unknown>, ref: string): ImageRef | null {
  const source = raw.source as { type?: string; media_type?: string; data?: string } | undefined
  if (source?.type !== 'base64' || typeof source.data !== 'string' || !IMAGE_TYPES.has(source.media_type ?? '')) return null
  return { ref, mediaType: source.media_type!, bytes: Math.floor((source.data.length * 3) / 4) }
}

/** Recently opened images, so the chunked transfer of one image scans the file only once. */
const images = new Map<string, { mediaType: string; data: string }>()
let imageBytes = 0
const IMAGE_CACHE_BYTES = 24 * 1024 * 1024

function cacheImage(key: string, image: { mediaType: string; data: string }): void {
  images.set(key, image)
  imageBytes += image.data.length
  while (imageBytes > IMAGE_CACHE_BYTES && images.size > 1) {
    const [oldest, value] = images.entries().next().value as [string, { data: string }]
    images.delete(oldest)
    imageBytes -= value.data.length
  }
}

/** The base64 data of one image, found by its ref (`<entry uuid>|<block>[|<tool-result part>]`). */
export async function readClaudeImage(path: string, ref: string): Promise<{ mediaType: string; data: string } | null> {
  const [uuid, blockText, partText] = ref.split('|')
  if (!uuid || blockText === undefined) return null
  const key = `${path}\0${ref}`
  const cached = images.get(key)
  if (cached) return cached
  const handle = await open(path, 'r')
  let buffer: Buffer
  try {
    const size = (await handle.stat()).size
    // Images can sit further back than the conversation tail; read more, still bounded.
    const start = Math.max(0, size - IMAGE_SCAN_BYTES)
    buffer = Buffer.alloc(size - start)
    await handle.read(buffer, 0, buffer.length, start)
  } finally {
    await handle.close()
  }
  // Search the raw bytes and decode only the lines that mention this entry.
  const needle = Buffer.from(uuid)
  for (let at = buffer.indexOf(needle); at >= 0; at = buffer.indexOf(needle, at + needle.length)) {
    const lineStart = buffer.lastIndexOf(0x0a, at) + 1
    const newline = buffer.indexOf(0x0a, at)
    const lineEnd = newline < 0 ? buffer.length : newline
    try {
      const entry = JSON.parse(buffer.toString('utf8', lineStart, lineEnd)) as { uuid?: string; message?: { content?: unknown } }
      if (entry.uuid !== uuid || !Array.isArray(entry.message?.content)) continue
      let block = (entry.message!.content as Record<string, unknown>[])[Number(blockText)]
      if (partText !== undefined) block = (Array.isArray(block?.content) ? (block.content as Record<string, unknown>[]) : [])[Number(partText)]
      const source = block?.source as { type?: string; media_type?: string; data?: string } | undefined
      if (source?.type === 'base64' && typeof source.data === 'string' && IMAGE_TYPES.has(source.media_type ?? '')) {
        const image = { mediaType: source.media_type!, data: source.data }
        cacheImage(key, image)
        return image
      }
    } catch {
      // partial line
    }
    at = Math.max(at, lineEnd - needle.length)
  }
  return null
}
