// Find inside an agent's conversation: keeps the messages that mention the query, plus the other
// half of any tool call / tool result pair so the chat still reads correctly.
import type { ConversationBlock, ConversationMessage } from './conversation-to-thread.ts'

function blockText(block: ConversationBlock): string {
  switch (block.type) {
    case 'text':
    case 'thinking':
      return block.text
    case 'tool-call':
      return `${block.name} ${block.input}`
    case 'tool-result':
      return block.output
    case 'image':
      return ''
  }
}

export function messageText(message: ConversationMessage): string {
  return message.blocks.map(blockText).join('\n')
}

/** Case-insensitive count of `needle` in `text` (needle already lower-cased). */
export function countMatches(text: string, needle: string): number {
  if (!needle) return 0
  const haystack = text.toLowerCase()
  let count = 0
  for (let i = haystack.indexOf(needle); i >= 0; i = haystack.indexOf(needle, i + needle.length)) count++
  return count
}

const resultsOnly = (m: ConversationMessage) => m.role === 'user' && m.blocks.length > 0 && m.blocks.every((b) => b.type === 'tool-result')
const hasToolCall = (m: ConversationMessage) => m.role === 'assistant' && m.blocks.some((b) => b.type === 'tool-call')

export function searchConversation(messages: ConversationMessage[], query: string): { messages: ConversationMessage[]; matches: number } {
  const needle = query.trim().toLowerCase()
  if (!needle) return { messages, matches: 0 }
  const keep = new Set<number>()
  let matches = 0
  messages.forEach((message, i) => {
    const n = countMatches(messageText(message), needle)
    if (!n) return
    matches += n
    keep.add(i)
    if (resultsOnly(message) && i > 0 && hasToolCall(messages[i - 1])) keep.add(i - 1)
    if (hasToolCall(message) && i + 1 < messages.length && resultsOnly(messages[i + 1])) keep.add(i + 1)
  })
  return { messages: messages.filter((_, i) => keep.has(i)), matches }
}
