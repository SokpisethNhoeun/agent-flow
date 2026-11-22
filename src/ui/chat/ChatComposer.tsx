// The message box, shaped like Orca's: a rounded card with attached images on top, the text
// field, and a toolbar (attach, how the message is delivered, the agent's model and effort, and a
// round send button). Images come from paste, drag and drop, or the attach button.
import { useRef, useState, type DragEvent } from 'react'
import type { AgentRecord } from '../../shared/model.ts'
import { Icon } from '../components/Icon.tsx'
import { Tip } from '../components/ui/Controls.tsx'
import { shortModel } from '../graph/status.ts'
import { IMAGE_TYPES, useImageAttachments } from './use-image-attachments.ts'

export type SendFn = (text: string, attachments: string[]) => Promise<boolean>

function routeLabel(agent: AgentRecord): string {
  if (agent.terminalId) return 'Terminal'
  if (agent.paneKey?.startsWith('structured-agent-session-')) return 'Chat session'
  if (agent.dispatchId) return 'Orchestration'
  return 'No route'
}

const imagesOf = (list: FileList | null | undefined) => [...(list ?? [])].filter((file) => file.type.startsWith('image/'))

export function ChatComposer({ agent, send, note }: { agent: AgentRecord; send: SendFn | null; note: string }) {
  const [text, setText] = useState('')
  const [state, setState] = useState<{ sending: boolean; error: string | null }>({ sending: false, error: null })
  const [dragging, setDragging] = useState(false)
  const images = useImageAttachments()
  const fileInput = useRef<HTMLInputElement>(null)
  const name = agent.title ?? 'this agent'
  const canSend = Boolean(send) && !state.sending && !images.uploading && !images.failed && Boolean(text.trim() || images.readyIds.length)

  const addImages = (files: File[]) => {
    const problem = images.add(files)
    setState((s) => ({ ...s, error: problem }))
  }
  const submit = async () => {
    if (!send || !canSend) return
    setState({ sending: true, error: null })
    try {
      const ok = await send(text.trim(), images.readyIds)
      if (ok) {
        setText('')
        images.clear()
      }
      setState({ sending: false, error: ok ? null : 'Not sent. The reason is in the notification; your message is kept.' })
    } catch (error) {
      setState({ sending: false, error: (error as Error).message })
    }
  }
  const onDrop = (event: DragEvent) => {
    setDragging(false)
    const files = imagesOf(event.dataTransfer?.files)
    if (!send || !files.length) return
    event.preventDefault()
    addImages(files)
  }
  const model = shortModel(agent.model)
  return (
    <div className="af-chat-composer">
      <div
        className={`af-chat-composer-card ${send ? '' : 'disabled'} ${state.sending ? 'sending' : ''} ${dragging ? 'dragging' : ''}`}
        onDragOver={(e) => {
          if (!send || ![...(e.dataTransfer?.types ?? [])].includes('Files')) return
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
        {images.items.length ? (
          <div className="af-chat-attachments" aria-label="Attached images">
            {images.items.map((item) => (
              <div key={item.key} className={`af-chat-attachment ${item.state}`} title={item.state === 'error' ? `Not attached: ${item.error}` : item.name}>
                <img src={item.url} alt={item.name} />
                {item.state === 'uploading' ? <span className="af-chat-attachment-busy" aria-label="Uploading"><span className="af-chat-spinner dark" /></span> : null}
                {item.state === 'error' ? <span className="af-chat-attachment-busy" aria-hidden><Icon name="alert" size={16} /></span> : null}
                <button type="button" className="af-chat-attachment-remove" aria-label={`Remove ${item.name}`} onClick={() => images.remove(item.key)}>
                  <Icon name="close" size={11} />
                </button>
              </div>
            ))}
          </div>
        ) : null}
        {send ? (
          <textarea
            className="af-chat-input"
            rows={2}
            maxLength={20000}
            value={text}
            placeholder={`Message ${name}`}
            onChange={(e) => setText(e.target.value)}
            onPaste={(e) => {
              const files = imagesOf(e.clipboardData?.files)
              if (!files.length) return
              e.preventDefault()
              addImages(files)
            }}
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
          {send ? (
            <>
              <Tip content="Attach images (or paste / drop them): PNG, JPEG, WebP, GIF, up to 10 MB, 5 per message">
                <button type="button" className="af-chat-icon-btn big" aria-label="Attach images" onClick={() => fileInput.current?.click()}>
                  <Icon name="paperclip" size={16} />
                </button>
              </Tip>
              <input
                ref={fileInput}
                type="file"
                accept={IMAGE_TYPES.join(',')}
                multiple
                hidden
                onChange={(e) => {
                  addImages(imagesOf(e.currentTarget.files))
                  e.currentTarget.value = ''
                }}
              />
            </>
          ) : null}
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
              <Tip content={images.uploading ? 'Waiting for images to upload…' : 'Enter to send · Shift+Enter for a new line'}>
                <button type="button" className="af-chat-send" onClick={() => void submit()} disabled={!canSend} aria-label="Send message">
                  {state.sending ? <span className="af-chat-spinner" aria-hidden="true" /> : <Icon name="arrowUp" size={16} />}
                </button>
              </Tip>
            ) : null}
          </span>
        </div>
      </div>
      {state.error ? <div className="af-chat-composer-error" role="alert">{state.error}</div> : null}
      {images.items
        .filter((item) => item.state === 'error')
        .map((item) => (
          <div key={item.key} className="af-chat-composer-error" role="alert">
            {item.name} could not be attached: {item.error} Remove it to send the rest.
          </div>
        ))}
    </div>
  )
}
