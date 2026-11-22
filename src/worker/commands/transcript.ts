// Reads a worker's conversation with `orca orchestration worker-read` (transcript when Orca has
// one, labelled terminal output otherwise) and normalizes it for the inspector.
import { redact, stripAnsi, truncate } from '../../shared/redact.ts'
import type { CliRunner } from '../cli/orca-cli.ts'

export type ConversationBlock =
  | { type: 'text'; text: string }
  | { type: 'thinking'; text: string }
  | { type: 'tool-call'; name: string; input: string }
  | { type: 'tool-result'; output: string; isError: boolean; images?: ImageRef[] }
  | { type: 'image'; image: ImageRef }

/** An image kept in the transcript; its bytes are fetched on demand with `agent.image`. */
export type ImageRef = { ref: string; mediaType: string; bytes: number }

export type ConversationMessage = { id: string; role: string; ts: number | null; blocks: ConversationBlock[]; model?: string | null; effort?: string | null }

export type AgentOutput =
  | { kind: 'conversation'; source: string; provider: string | null; messages: ConversationMessage[]; truncated: boolean }
  | { kind: 'lines'; source: string; lines: string[]; truncated: boolean }

const PAGE_LIMIT = 100
const MAX_PAGES = 8
const KEEP_MESSAGES = 160
const TEXT_LIMIT = 4000
const TOOL_LIMIT = 1500

type RawRead = {
  source?: string
  provider?: string | null
  transcript?: { messages?: unknown[]; nextCursor?: string | null } | null
  cursor?: string | null
  rows?: unknown[]
  lines?: unknown[]
  text?: string
}

/** Pages forward through the transcript and keeps the newest messages. */
export async function readWorkerOutput(cli: CliRunner, dispatchId: string): Promise<AgentOutput | null> {
  const messages: ConversationMessage[] = []
  let cursor: string | null = null
  let first: RawRead | null = null
  let truncated = false
  for (let page = 0; page < MAX_PAGES; page++) {
    const args = ['orchestration', 'worker-read', '--dispatch', dispatchId, '--limit', String(PAGE_LIMIT), '--full']
    if (cursor) args.push('--cursor', cursor)
    const result = await cli.run<RawRead>(args, { timeoutMs: 20000 })
    if (!result.ok) {
      if (!first) return null
      break
    }
    first ??= result.result
    const transcript = result.result.transcript
    if (!transcript?.messages) break
    for (const raw of transcript.messages) {
      const message = normalizeMessage(raw)
      if (message) messages.push(message)
    }
    if (messages.length > KEEP_MESSAGES) {
      messages.splice(0, messages.length - KEEP_MESSAGES)
      truncated = true
    }
    cursor = transcript.nextCursor ?? null
    if (!cursor) break
    if (page === MAX_PAGES - 1) truncated = true
  }
  if (!first) return null
  if (first.transcript) return { kind: 'conversation', source: first.source ?? 'transcript', provider: first.provider ?? null, messages, truncated }
  return { kind: 'lines', source: first.source ?? 'terminal', lines: flattenLines(first), truncated: false }
}

export function normalizeMessage(raw: unknown): ConversationMessage | null {
  if (!raw || typeof raw !== 'object') return null
  const m = raw as Record<string, unknown>
  const blocks: ConversationBlock[] = []
  const rawBlocks = Array.isArray(m.blocks) ? m.blocks : typeof m.text === 'string' ? [{ type: 'text', text: m.text }] : []
  for (const b of rawBlocks as Record<string, unknown>[]) {
    const type = String(b?.type ?? '')
    if (type === 'text' && typeof b.text === 'string') blocks.push({ type: 'text', text: clean(b.text, TEXT_LIMIT) })
    else if ((type === 'thinking' || type === 'reasoning') && typeof b.text === 'string') blocks.push({ type: 'thinking', text: clean(b.text, TEXT_LIMIT) })
    else if (type === 'tool-call') blocks.push({ type: 'tool-call', name: String(b.name ?? 'tool'), input: clean(typeof b.input === 'string' ? b.input : JSON.stringify(b.input ?? {}), TOOL_LIMIT) })
    else if (type === 'tool-result') blocks.push({ type: 'tool-result', output: clean(typeof b.output === 'string' ? b.output : JSON.stringify(b.output ?? ''), TOOL_LIMIT), isError: b.isError === true || b.is_error === true })
  }
  if (!blocks.length) return null
  return { id: String(m.id ?? Math.random()), role: String(m.role ?? 'assistant'), ts: typeof m.timestamp === 'number' ? m.timestamp : null, blocks }
}

export function flattenLines(result: RawRead): string[] {
  const rows = (Array.isArray(result.rows) ? result.rows : Array.isArray(result.lines) ? result.lines : []) as unknown[]
  const lines: string[] = []
  for (const row of rows) {
    if (typeof row === 'string') lines.push(row)
    else if (row && typeof row === 'object') {
      const r = row as Record<string, unknown>
      const text = r.text ?? r.content ?? r.line ?? r.message
      lines.push(typeof text === 'string' ? text : JSON.stringify(row))
    }
  }
  if (!lines.length && typeof result.text === 'string') lines.push(...result.text.split('\n'))
  return lines.slice(-1000).map((line) => clean(line, TEXT_LIMIT))
}

function clean(text: string, max: number): string {
  return redact(stripAnsi(truncate(text, max)))
}
