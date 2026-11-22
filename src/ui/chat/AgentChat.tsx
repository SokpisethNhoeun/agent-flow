// The agent's conversation, styled like Orca's chat tab and built on assistant-ui: a centered
// column of messages (the person's as bubbles, the agent's as plain text), tool calls as quiet
// grouped rows, and a composer that sends through whatever route Orca allows for this agent.
import { AssistantRuntimeProvider, ThreadPrimitive, useExternalStoreRuntime, type AppendMessage, type ThreadMessageLike } from '@assistant-ui/react'
import { useCallback, useMemo } from 'react'
import type { AgentRecord } from '../../shared/model.ts'
import { ScrollArea } from '../components/ui/ScrollArea.tsx'
import { ChatComposer } from './ChatComposer.tsx'
import { ChatAgentContext } from './ChatImage.tsx'
import { AssistantMessage, UserMessage } from './ChatMessages.tsx'
import { WorkingIndicator } from './ChatParts.tsx'
import { toThread, type ConversationMessage } from './conversation-to-thread.ts'

type Props = {
  agent: AgentRecord
  messages: ConversationMessage[]
  truncated: boolean
  /** null when sending is not possible; the string explains why. */
  send: ((text: string) => Promise<boolean>) | null
  sendNote: string
  working: boolean
  onLoadEarlier?: (() => void) | null
  loadingEarlier?: boolean
}

const MESSAGE_COMPONENTS = { UserMessage, AssistantMessage }

export function AgentChat({ agent, messages, truncated, send, sendNote, working, onLoadEarlier, loadingEarlier }: Props) {
  const thread = useMemo(() => toThread(messages), [messages])
  const onNew = useCallback(
    async (message: AppendMessage) => {
      const text = message.content.map((part) => (part.type === 'text' ? part.text : '')).join('\n').trim()
      if (text && send) await send(text)
    },
    [send]
  )
  const runtime = useExternalStoreRuntime<ThreadMessageLike>({
    messages: thread as unknown as ThreadMessageLike[],
    convertMessage: (m) => m,
    isRunning: working,
    // The transcript is read-only here; sending goes through our composer.
    isDisabled: true,
    onNew
  })
  return (
    <ChatAgentContext.Provider value={agent.id}>
      <AssistantRuntimeProvider runtime={runtime}>
        <ThreadPrimitive.Root className="af-chat">
          <ScrollArea asChild className="af-chat-scroll">
            <ThreadPrimitive.Viewport className="af-chat-viewport" autoScroll>
              <div className="af-chat-column">
                {onLoadEarlier ? (
                  <button className="af-chat-earlier" onClick={onLoadEarlier} disabled={loadingEarlier}>
                    {loadingEarlier ? 'Loading…' : 'Load earlier messages'}
                  </button>
                ) : truncated ? (
                  <div className="af-chat-note">Showing the newest messages.</div>
                ) : null}
                <ThreadPrimitive.Empty>
                  <div className="af-chat-note">No messages yet.</div>
                </ThreadPrimitive.Empty>
                <ThreadPrimitive.Messages components={MESSAGE_COMPONENTS} />
                {working ? <WorkingIndicator /> : null}
              </div>
            </ThreadPrimitive.Viewport>
          </ScrollArea>
          <ChatComposer agent={agent} send={send} note={sendNote} />
        </ThreadPrimitive.Root>
      </AssistantRuntimeProvider>
    </ChatAgentContext.Provider>
  )
}
