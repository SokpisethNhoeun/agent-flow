// Turns an agent's recorded conversation into assistant-ui messages. Claude stores a tool's result
// as a separate "user" entry; it is paired back onto the assistant tool call that asked for it,
// so the thread reads like a chat instead of alternating raw entries.

export type ImageRef = { ref: string; mediaType: string; bytes: number }

export type ConversationBlock =
  | { type: 'text'; text: string }
  | { type: 'thinking'; text: string }
  | { type: 'tool-call'; name: string; input: string }
  | { type: 'tool-result'; output: string; isError: boolean; images?: ImageRef[] }
  | { type: 'image'; image: ImageRef }

export type ConversationMessage = { id: string; role: string; ts: number | null; blocks: ConversationBlock[]; model?: string | null; effort?: string | null }

type Part =
  | { type: 'text'; text: string }
  | { type: 'reasoning'; text: string }
  | { type: 'tool-call'; toolCallId: string; toolName: string; argsText: string; result?: string; isError?: boolean }
  | { type: 'data-image'; data: ImageRef }

export type ChatMessage = {
  id: string
  role: 'user' | 'assistant'
  content: Part[]
  createdAt?: Date
  metadata: { custom: { model: string | null; effort: string | null } }
}

export function toThread(messages: ConversationMessage[]): ChatMessage[] {
  const out: ChatMessage[] = []
  /** Tool calls still waiting for their result, oldest first. */
  let pending: Extract<Part, { type: 'tool-call' }>[] = []
  let current: ChatMessage | null = null
  for (const message of messages) {
    const onlyResults = message.blocks.every((b) => b.type === 'tool-result')
    if (message.role === 'user' && onlyResults && current?.role === 'assistant') {
      for (const block of message.blocks) {
        if (block.type !== 'tool-result') continue
        const call = pending.shift()
        if (call) {
          call.result = block.output
          call.isError = block.isError
        } else {
          current.content.push({ type: 'tool-call', toolCallId: `${message.id}-r`, toolName: 'result', argsText: '', result: block.output, isError: block.isError })
        }
        for (const image of block.images ?? []) current.content.push({ type: 'data-image', data: image })
      }
      continue
    }
    const role = message.role === 'user' ? 'user' : 'assistant'
    // Consecutive assistant entries (one per tool step) render as one assistant turn.
    if (role === 'assistant' && current?.role === 'assistant') {
      appendParts(current, message, pending)
      if (message.model) current.metadata.custom = { model: message.model, effort: message.effort ?? null }
      continue
    }
    current = { id: message.id, role, content: [], createdAt: message.ts ? new Date(message.ts) : undefined, metadata: { custom: { model: message.model ?? null, effort: message.effort ?? null } } }
    pending = []
    appendParts(current, message, pending)
    if (current.content.length) out.push(current)
  }
  return out.filter((m) => m.content.length > 0)
}

function appendParts(target: ChatMessage, message: ConversationMessage, pending: Extract<Part, { type: 'tool-call' }>[]): void {
  message.blocks.forEach((block, i) => {
    switch (block.type) {
      case 'text':
        target.content.push({ type: 'text', text: block.text })
        break
      case 'thinking':
        if (target.role === 'assistant') target.content.push({ type: 'reasoning', text: block.text })
        break
      case 'tool-call': {
        // Only assistant messages may hold tool calls (assistant-ui refuses them in user messages).
        if (target.role !== 'assistant') {
          target.content.push({ type: 'text', text: `▸ ${block.name}` })
          break
        }
        const part = { type: 'tool-call' as const, toolCallId: `${message.id}-${i}`, toolName: block.name, argsText: block.input }
        target.content.push(part)
        pending.push(part)
        break
      }
      case 'tool-result':
        if (target.role === 'assistant') target.content.push({ type: 'tool-call', toolCallId: `${message.id}-${i}`, toolName: 'result', argsText: '', result: block.output, isError: block.isError })
        else if (block.output.trim()) target.content.push({ type: 'text', text: '```\n' + block.output + '\n```' })
        for (const image of block.images ?? []) target.content.push({ type: 'data-image', data: image })
        break
      case 'image':
        target.content.push({ type: 'data-image', data: block.image })
        break
    }
  })
}
