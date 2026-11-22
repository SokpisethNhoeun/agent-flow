// Message parts styled like Orca's chat tab: tool calls as quiet one-line rows (grouped into a
// "Ran 3 commands, read 2 files" summary), thinking as a "Thought" disclosure, code blocks with a
// language header and copy button.
import { useAuiState } from '@assistant-ui/react'
import { MarkdownTextPrimitive } from '@assistant-ui/react-markdown'
import remarkGfm from 'remark-gfm'
import { useState, type ReactNode } from 'react'
import { Icon, type IconName } from '../components/Icon.tsx'
import { copyText } from './copy-text.ts'
import { describeTool, summarizeTools, type ToolKind } from './tool-labels.ts'

const TOOL_ICON: Record<ToolKind, IconName> = { command: 'terminal', read: 'file', edit: 'pencil', search: 'search', other: 'settings' }

export function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      className={`af-chat-icon-btn ${copied ? 'copied' : ''}`}
      aria-label={copied ? 'Copied' : label}
      title={copied ? 'Copied' : label}
      onClick={async () => {
        if (await copyText(text)) {
          setCopied(true)
          setTimeout(() => setCopied(false), 1500)
        }
      }}
    >
      <Icon name={copied ? 'check' : 'copy'} size={14} />
    </button>
  )
}

function CodeHeader({ language, code }: { language?: string; code: string }) {
  return (
    <div className="af-chat-code-head">
      <span>{language || 'text'}</span>
      <CopyButton text={code} label="Copy code" />
    </div>
  )
}

export function MarkdownText() {
  return <MarkdownTextPrimitive remarkPlugins={[remarkGfm]} className="af-md" components={{ CodeHeader }} />
}

/** "Thought": collapsed reasoning, faint, indented when open. */
export function Thinking({ text }: { text: string }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="af-chat-reasoning">
      <button type="button" className="af-chat-disclosure" aria-expanded={open} onClick={() => setOpen(!open)}>
        <Icon name="brain" size={15} />
        <span>Thought</span>
        <span className={`af-chat-chevron ${open ? 'open' : ''}`} aria-hidden>
          <Icon name="chevron" size={14} />
        </span>
      </button>
      {open ? <div className="af-chat-reasoning-body">{text}</div> : null}
    </div>
  )
}

/** One tool call: icon, verb, target; opens to show the input and output. */
export function ToolLine({ toolName, argsText, result, isError }: { toolName: string; argsText?: string; result?: unknown; isError?: boolean }) {
  const [open, setOpen] = useState(false)
  const output = typeof result === 'string' ? result : result === undefined ? '' : JSON.stringify(result, null, 2)
  const running = result === undefined
  const { kind, verb, target } = describeTool(toolName, argsText ?? '', isError)
  return (
    <div className={`af-chat-tool-line ${isError ? 'error' : ''}`}>
      <button type="button" className="af-chat-tool-row" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className={running ? 'af-chat-spin' : ''}>
          <Icon name={running ? 'loader' : isError ? 'alert' : TOOL_ICON[kind]} size={15} />
        </span>
        <span className="af-chat-tool-verb">{verb}</span>
        <span className="af-chat-tool-target" title={target}>{target}</span>
        <span className="af-chat-tool-end">
          {isError ? <span className="af-chat-tool-failed">failed</span> : null}
          <span className={`af-chat-chevron ${open ? 'open' : ''}`} aria-hidden>
            <Icon name="chevron" size={14} />
          </span>
        </span>
      </button>
      {open ? (
        <div className="af-chat-tool-detail">
          {argsText ? <pre className="af-chat-pre">{pretty(argsText)}</pre> : null}
          {output ? <pre className={`af-chat-pre ${isError ? 'error' : ''}`}>{output}</pre> : running ? <div className="af-chat-faint">Still running…</div> : null}
        </div>
      ) : null}
    </div>
  )
}

/** Several tool calls in a row: one summary line ("Ran 3 commands, read 2 files"), opens to the list. */
export function ToolGroup({ startIndex, endIndex, children }: { startIndex: number; endIndex: number; children?: ReactNode }) {
  // Primitive values only: a new array from the selector would re-render forever.
  const names = useAuiState((s) => s.message.parts.slice(startIndex, endIndex + 1).map((p) => (p.type === 'tool-call' ? p.toolName : '')).join('|'))
  const running = useAuiState((s) => s.message.parts.slice(startIndex, endIndex + 1).some((p) => p.type === 'tool-call' && p.result === undefined))
  const failed = useAuiState((s) => s.message.parts.slice(startIndex, endIndex + 1).some((p) => p.type === 'tool-call' && p.isError === true))
  const [open, setOpen] = useState(false)
  const list = names.split('|').filter(Boolean)
  if (list.length < 2) return <>{children}</>
  return (
    <div className="af-chat-tool-group">
      <button type="button" className="af-chat-disclosure" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className={running ? 'af-chat-spin' : ''}>
          <Icon name={running ? 'loader' : 'terminal'} size={15} />
        </span>
        <span className={running ? 'af-chat-live' : ''}>{summarizeTools(list, running)}</span>
        {!running && !failed ? <Icon name="check" size={12} /> : null}
        {failed ? <span className="af-chat-tool-failed">some failed</span> : null}
        <span className={`af-chat-chevron ${open ? 'open' : ''}`} aria-hidden>
          <Icon name="chevron" size={14} />
        </span>
      </button>
      {open ? <div className="af-chat-tool-list">{children}</div> : null}
    </div>
  )
}

export function WorkingIndicator() {
  return (
    <div className="af-chat-working" aria-live="polite">
      <span className="af-chat-spin">
        <Icon name="loader" size={15} />
      </span>
      <span>Working…</span>
    </div>
  )
}

function pretty(argsText: string): string {
  try {
    return JSON.stringify(JSON.parse(argsText), null, 2)
  } catch {
    return argsText
  }
}
