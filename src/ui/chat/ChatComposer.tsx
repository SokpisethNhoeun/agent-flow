// The message box, shaped like Orca's: a rounded card with the text field on top and a toolbar
// below (how the message is delivered, the agent's model and effort, and a round send button).
// It calls the agent's send route directly and shows every result.
import { useState } from 'react'
import type { AgentRecord } from '../../shared/model.ts'
import { Icon } from '../components/Icon.tsx'
import { Tip } from '../components/ui/Controls.tsx'
import { shortModel } from '../graph/status.ts'

function routeLabel(agent: AgentRecord): string {
  if (agent.terminalId) return 'Terminal'
  if (agent.paneKey?.startsWith('structured-agent-session-')) return 'Chat session'
  if (agent.dispatchId) return 'Orchestration'
  return 'No route'
}

export function ChatComposer({ agent, send, note }: { agent: AgentRecord; send: ((text: string) => Promise<boolean>) | null; note: string }) {
  const [text, setText] = useState('')
  const [state, setState] = useState<{ sending: boolean; error: string | null }>({ sending: false, error: null })
  const name = agent.title ?? 'this agent'
  const submit = async () => {
    const value = text.trim()
    if (!send || !value || state.sending) return
    setState({ sending: true, error: null })
    try {
      const ok = await send(value)
      if (ok) setText('')
      setState({ sending: false, error: ok ? null : 'Not sent. The reason is in the notification; your text is kept.' })
    } catch (error) {
      setState({ sending: false, error: (error as Error).message })
    }
  }
  const model = shortModel(agent.model)
  return (
    <div className="af-chat-composer">
      <div className={`af-chat-composer-card ${send ? '' : 'disabled'} ${state.sending ? 'sending' : ''}`}>
        {send ? (
          <textarea
            className="af-chat-input"
            rows={2}
            maxLength={20000}
            value={text}
            placeholder={`Message ${name}`}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault()
                void submit()
              }
            }}
            aria-label={`Message ${name}`}
          />
        ) : (
          <div className="af-chat-input af-chat-cannot" role="note">
            {note}
          </div>
        )}
        <div className="af-chat-toolbar">
          <Tip content={note}>
            <span className="af-chat-pill" tabIndex={0} aria-label={`Delivery: ${routeLabel(agent)}. ${note}`}>
              <Icon name={agent.terminalId ? 'terminal' : 'message'} size={13} />
              {routeLabel(agent)}
            </span>
          </Tip>
          {model ? (
            <Tip content="The agent's model and effort, as its session reports them. Orca has no API to change them from here.">
              <span className="af-chat-pill" tabIndex={0}>
                <b>{model}</b>
                {agent.effort ? <span>{agent.effort}</span> : null}
              </span>
            </Tip>
          ) : null}
          <span className="af-chat-toolbar-end">
            {send ? (
              <Tip content="Enter to send · Shift+Enter for a new line">
                <button type="button" className="af-chat-send" onClick={() => void submit()} disabled={!text.trim() || state.sending} aria-label="Send message">
                  {state.sending ? <span className="af-chat-spinner" aria-hidden="true" /> : <Icon name="arrowUp" size={16} />}
                </button>
              </Tip>
            ) : null}
          </span>
        </div>
      </div>
      {state.error ? <div className="af-chat-composer-error" role="alert">{state.error}</div> : null}
    </div>
  )
}
