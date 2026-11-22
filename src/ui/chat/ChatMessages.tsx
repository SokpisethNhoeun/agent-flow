// Messages laid out like Orca's chat tab: the person's message is a right-aligned bubble with a
// copy/time row on hover; the agent's reply is plain text (no bubble, no avatar) with a copy,
// model and time row, always shown on the latest reply.
import { MessagePrimitive, useAuiState } from '@assistant-ui/react'
import { memo } from 'react'
import { clock } from '../components/primitives.tsx'
import { shortModel } from '../graph/status.ts'
import { ChatImage } from './ChatImage.tsx'
import { CopyButton, MarkdownText, Thinking, ToolGroup, ToolLine } from './ChatParts.tsx'

const partComponents = {
  Text: MarkdownText,
  Reasoning: Thinking,
  tools: { Fallback: ToolLine },
  ToolGroup,
  data: {
    by_name: {
      image: ({ data }: { data: { ref: string; mediaType: string; bytes: number } }) => <ChatImage data={data} />
    }
  }
}

function useMessageText(): string {
  return useAuiState((s) => s.message.parts.map((p) => (p.type === 'text' ? p.text : '')).filter(Boolean).join('\n\n'))
}

function useMessageTime(): number | null {
  return useAuiState((s) => s.message.createdAt?.getTime() ?? null)
}

export const UserMessage = memo(function UserMessage() {
  const text = useMessageText()
  const ts = useMessageTime()
  return (
    <MessagePrimitive.Root className="af-chat-row user">
      <div className="af-chat-bubble">
        <MessagePrimitive.Parts components={partComponents as never} />
      </div>
      <div className="af-chat-actions hover-only">
        {text ? <CopyButton text={text} label="Copy message" /> : null}
        {ts ? <span className="af-chat-time">{clock(ts)}</span> : null}
      </div>
    </MessagePrimitive.Root>
  )
})

export const AssistantMessage = memo(function AssistantMessage() {
  const text = useMessageText()
  const ts = useMessageTime()
  const isLast = useAuiState((s) => s.message.isLast)
  const model = useAuiState((s) => ((s.message.metadata as { custom?: { model?: string | null } }).custom?.model ?? null))
  const effort = useAuiState((s) => ((s.message.metadata as { custom?: { effort?: string | null } }).custom?.effort ?? null))
  return (
    <MessagePrimitive.Root className="af-chat-row assistant">
      <div className="af-chat-prose">
        <MessagePrimitive.Parts components={partComponents as never} />
      </div>
      <div className={`af-chat-actions ${isLast ? '' : 'hover-only'}`}>
        {text ? <CopyButton text={text} label="Copy reply" /> : null}
        {model ? <span className="af-chat-time">{shortModel(model)}{effort ? ` · ${effort}` : ''}</span> : null}
        {ts ? <span className="af-chat-time">{clock(ts)}</span> : null}
      </div>
    </MessagePrimitive.Root>
  )
})
