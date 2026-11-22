// Send a prompt to an agent where Orca allows it. Says up front how the text will be delivered,
// or why it cannot be (chat sessions and subagents have no API).
import { useState } from 'react'
import type { AgentRecord } from '../../../shared/model.ts'
import { Button } from '../../components/primitives.tsx'
import { useApp, useFlowView } from '../../state/app-context.tsx'

/** Chats already confirmed in this window. */
const confirmedChats = new Set<string>()

type Route = { canSend: true; how: string } | { canSend: false; why: string }

export function promptRoute(agent: AgentRecord, available: boolean, chatSend: boolean): Route {
  if (!available) return { canSend: false, why: 'This Orca offers no way for plugins to send text to agents.' }
  if (agent.role === 'subagent') return { canSend: false, why: 'A subagent only takes its brief from its parent. Message the parent agent instead.' }
  if (agent.role === 'lead' && !agent.terminalId) return { canSend: false, why: 'This Run’s coordinator has no terminal Orca reports; message it from its own session.' }
  if (agent.terminalId) return { canSend: true, how: 'Typed into the agent’s terminal and submitted.' }
  if (agent.paneKey?.startsWith('structured-agent-session-')) {
    return chatSend
      ? { canSend: true, how: 'Sent into the chat session, like typing in its tab (experimental: through Orca’s local runtime). Queued if the agent is busy.' }
      : { canSend: false, why: 'Sending into chat sessions is turned off in Agent Flow settings.' }
  }
  if (agent.dispatchId) return { canSend: true, how: 'Sent to this worker as an orchestration message. Orca may require the Run’s coordinator; if so you get the exact command to paste there.' }
  return { canSend: false, why: 'Orca has no API for plugins to send a message into a chat session. Open the session in Orca and type there.' }
}

/** How a prompt reaches this agent, and a send function (null when it cannot be sent). */
export function usePromptSender(agent: AgentRecord): { route: Route; send: ((text: string) => Promise<boolean>) | null } {
  const { runCommand, client } = useApp()
  const { state, mode } = useFlowView()
  const viewOnly = client.transport.kind === 'http' && state.capabilities.dashboardControls !== true
  const route: Route = viewOnly
    ? { canSend: false, why: 'This browser dashboard is view-only. Send from the Agent Flow panel inside Orca, or turn on “Allow controls from the browser dashboard” in Agent Flow settings.' }
    : promptRoute(agent, state.capabilities.commands['agent.prompt']?.available ?? false, state.capabilities.chatSend !== false)
  const send = async (text: string): Promise<boolean> => {
    // First message to a chat session: ask once (per session) before using the experimental route.
    const chat = Boolean(agent.paneKey?.startsWith('structured-agent-session-')) && !agent.terminalId
    const confirm = chat && !confirmedChats.has(agent.id) ? { title: 'Send into this chat session?', message: `Agent Flow will post your message into “${agent.title ?? 'this chat'}” as if you typed it in its tab. If the agent is busy, Orca queues it.`, label: 'Send', danger: false } : undefined
    const response = await runCommand('agent.prompt', { agentId: agent.id, text }, confirm)
    if (response?.ok && chat) confirmedChats.add(agent.id)
    return Boolean(response?.ok)
  }
  return { route, send: mode === 'replay' || !route.canSend ? null : send }
}

export function PromptComposer({ agent }: { agent: AgentRecord }) {
  const { mode } = useFlowView()
  const { route, send: sendPrompt } = usePromptSender(agent)
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const disabled = !sendPrompt

  const send = async () => {
    if (!sendPrompt || sending || !text.trim()) return
    setSending(true)
    try {
      if (await sendPrompt(text)) setText('')
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="af-composer">
      <textarea
        className="af-textarea"
        rows={3}
        maxLength={20000}
        value={text}
        disabled={disabled}
        placeholder={mode === 'replay' ? 'Replay is read-only' : route.canSend ? `Message ${agent.title ?? 'this agent'}… (Enter to send, Shift+Enter for a new line)` : 'Sending is not available for this agent'}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault()
            void send()
          }
        }}
        aria-label="Prompt message"
      />
      <div className="af-composer-foot">
        <span className="af-muted">{route.canSend ? route.how : route.why}</span>
        <Button variant="primary" size="sm" icon="message" disabled={disabled || sending || !text.trim()} onClick={() => void send()}>
          {sending ? 'Sending…' : 'Send'}
        </Button>
      </div>
    </div>
  )
}
