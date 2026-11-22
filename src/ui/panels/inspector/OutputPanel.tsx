// Live output of an agent: its recorded conversation (orchestration transcript) when Orca has
// one, otherwise terminal output. Refreshes while the agent is live; bounded rendering.
import { useCallback, useEffect, useRef, useState } from 'react'
import { newRequestId } from '../../../shared/commands.ts'
import type { AgentRecord } from '../../../shared/model.ts'
import { Button, EmptyState } from '../../components/primitives.tsx'
import { Switch } from '../../components/ui/Controls.tsx'
import { useApp } from '../../state/app-context.tsx'
import { usePromptSender } from './PromptComposer.tsx'
import { ChatComposer } from '../../chat/ChatComposer.tsx'
import { ChatBoundary } from '../../chat/ChatBoundary.tsx'
import { AgentChat } from '../../chat/LazyAgentChat.tsx'
import type { ConversationMessage } from '../../chat/conversation-to-thread.ts'
import { countMatches, searchConversation } from '../../chat/search-conversation.ts'
import { useTextHighlight } from '../../components/use-text-highlight.ts'
import { Icon } from '../../components/Icon.tsx'
import { ScrollArea } from '../../components/ui/ScrollArea.tsx'

const WINDOW = 600

type Output =
  | { kind: 'conversation'; source: string; provider: string | null; messages: ConversationMessage[]; truncated: boolean; push?: boolean }
  | { kind: 'lines'; source: string; lines: string[]; truncated: boolean; events?: boolean }

export function OutputPanel({ agent }: { agent: AgentRecord }) {
  const { client } = useApp()
  const [output, setOutput] = useState<Output | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [follow, setFollow] = useState(true)
  const { route, send } = usePromptSender(agent)
  const [earlier, setEarlier] = useState<{ messages: ConversationMessage[]; hasMore: boolean; loading: boolean }>({ messages: [], hasMore: true, loading: false })
  const ref = useRef<HTMLDivElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const [find, setFind] = useState<string | null>(null)
  useTextHighlight(bodyRef, find ?? '')

  const inFlight = useRef<string | null>(null)
  const again = useRef(false)
  const current = useRef(agent.id)
  current.current = agent.id
  /** The version on screen; the worker answers `unchanged` instead of resending it. */
  const version = useRef<string | null>(null)
  const load = useCallback(async () => {
    // One request at a time, and never show an answer meant for a previously selected agent.
    const forAgent = agent.id
    if (inFlight.current === forAgent) {
      // A change notice during a read: read once more afterwards so the last change is not missed.
      again.current = true
      return
    }
    inFlight.current = forAgent
    again.current = false
    try {
      const params: Record<string, unknown> = { agentId: forAgent }
      if (version.current) params.since = version.current
      const response = await client.transport.command({ requestId: newRequestId(), kind: 'agent.readOutput', params })
      if (current.current !== forAgent) return
      if (response.ok) {
        const result = response.result as (Output & { version?: string }) | { unchanged: true; version: string }
        setError(null)
        if ('unchanged' in result) return
        version.current = result.version ?? null
        setOutput(result)
      } else setError(response.error.message)
    } finally {
      if (inFlight.current === forAgent) inFlight.current = null
    }
    if (again.current && current.current === forAgent) {
      again.current = false
      void loadRef.current()
    }
  }, [client, agent.id])
  const loadRef = useRef(load)
  loadRef.current = load

  // When the worker pushes changes (Claude transcripts), polling is only a slow safety net.
  // Otherwise poll faster while the agent works, slower while it waits; never while hidden.
  // Terminals have no file to watch, but status changes and tool calls are announced, so the poll
  // only has to catch text printed between them.
  const push = output?.kind === 'conversation' && output.push === true
  const announced = !push && output !== null && 'events' in output && output.events === true
  const pollMs = !agent.live ? 0 : push ? (agent.state === 'working' ? 15000 : 30000) : announced ? (agent.state === 'working' ? 5000 : 20000) : agent.state === 'working' ? 2500 : 8000
  useEffect(
    () =>
      client.onOutput((agentId) => {
        if (agentId === current.current && !document.hidden) void load()
      }),
    [client, load]
  )
  useEffect(() => {
    version.current = null
    setOutput(null)
    setError(null)
    setEarlier({ messages: [], hasMore: true, loading: false })
    setFind(null)
  }, [agent.id])
  useEffect(() => {
    void load()
    if (!pollMs) return
    const timer = setInterval(() => {
      if (typeof document === 'undefined' || !document.hidden) void load()
    }, pollMs)
    const onVisible = () => {
      if (!document.hidden) void load()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [load, pollMs])

  useEffect(() => {
    if (follow && ref.current) ref.current.scrollTop = ref.current.scrollHeight
  }, [output, follow])

  // After sending, look again soon so the new message shows up (unless changes are pushed).
  const chatSend = send ? async (text: string, attachments: string[]) => { const ok = await send(text, attachments); if (ok && !push) setTimeout(() => void load(), 1500); return ok } : null
  if (error || !output)
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        <div style={{ flex: 1 }}>{error ? <EmptyState icon="terminal" title="No output">{error}</EmptyState> : <div className="af-empty">Loading…</div>}</div>
        <ChatComposer agent={agent} send={chatSend} note={route.canSend ? route.how : route.why} />
      </div>
    )
  const needle = (find ?? '').trim().toLowerCase()
  const allLines = output.kind === 'lines' ? output.lines.slice(-WINDOW) : []
  const lines = needle ? allLines.filter((line) => line.toLowerCase().includes(needle)) : allLines
  const fullConversation = output.kind === 'conversation' ? mergeMessages(earlier.messages, output.messages) : []
  const found = searchConversation(fullConversation, find ?? '')
  const conversation = found.messages
  const matchCount = output.kind === 'conversation' ? found.matches : lines.reduce((sum, line) => sum + countMatches(line, needle), 0)
  const canLoadEarlier = output.kind === 'conversation' && output.source === 'claude transcript' && (earlier.messages.length ? earlier.hasMore : output.truncated)
  const loadEarlier = async () => {
    const first = conversation[0]?.id
    if (!first || earlier.loading) return
    setEarlier((e) => ({ ...e, loading: true }))
    const response = await client.transport.command({ requestId: newRequestId(), kind: 'agent.readOutput', params: { agentId: agent.id, before: first } })
    if (current.current !== agent.id) return
    if (!response.ok) {
      setEarlier((e) => ({ ...e, loading: false }))
      return
    }
    const older = response.result as { messages: ConversationMessage[]; truncated: boolean }
    setEarlier((e) => ({ messages: mergeMessages(older.messages, e.messages), hasMore: older.messages.length > 0 && older.truncated, loading: false }))
  }
  const status = agent.live ? (agent.state === 'working' ? 'Working' : agent.state === 'waiting' ? 'Waiting for input' : agent.state === 'blocked' ? 'Needs attention' : 'Idle') : 'Not running'
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '6px 10px', borderBottom: '1px solid var(--af-border)', fontSize: 12, flexWrap: 'wrap' }}>
        <span className={`af-chat-status ${agent.live && agent.state === 'working' ? 'working' : ''}`} data-status={agent.live ? (agent.state === 'working' ? 'running' : agent.state === 'blocked' ? 'blocked' : 'waiting') : 'idle'}>
          <span className="af-dot" />
          {status}
        </span>
        <span className="af-muted" title={output.kind === 'conversation' ? output.source : 'terminal'}>
          {output.kind === 'conversation' ? (needle ? `${conversation.length} of ${fullConversation.length} messages` : `${conversation.length} messages`) : `Terminal${output.lines.length > WINDOW ? ` · last ${WINDOW} lines` : ''}`}
        </span>
        <span style={{ flex: 1 }} />
        {find === null ? (
          <Button size="sm" iconOnly icon="search" title="Find in output" onClick={() => setFind('')} />
        ) : (
          <span className="af-find">
            <Icon name="search" size={12} />
            <input
              className="af-input"
              autoFocus
              placeholder={output.kind === 'conversation' ? 'Find in conversation' : 'Find in output'}
              aria-label="Find in output"
              value={find}
              onChange={(e) => setFind(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  e.stopPropagation()
                  setFind(null)
                }
              }}
            />
            {needle ? <span className="af-muted" aria-live="polite">{matchCount ? `${matchCount} match${matchCount === 1 ? '' : 'es'}` : 'No matches'}</span> : null}
            <Button size="sm" iconOnly icon="close" title="Close find (Esc)" onClick={() => setFind(null)} />
          </span>
        )}
        {output.kind === 'lines' ? (
          <Switch checked={follow} onChange={setFollow} label="Follow" title="Keep scrolled to the newest output" />
        ) : null}
        {/* While finding, these shrink to icons so the header stays on one line. */}
        <Button size="sm" icon="retry" iconOnly={find !== null} title="Refresh" onClick={() => void load()}>{find === null ? 'Refresh' : null}</Button>
        {agent.terminalId ? (
          <Button size="sm" icon="terminal" iconOnly={find !== null} title="Open the agent’s terminal" onClick={() => void client.transport.command({ requestId: newRequestId(), kind: 'terminal.focus', params: { terminalId: agent.terminalId } })}>
            {find === null ? 'Open' : null}
          </Button>
        ) : null}
      </div>
      <div ref={bodyRef} style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      {output.kind === 'conversation' ? (
        <ChatBoundary fallback={<EmptyState icon="alert" title="This conversation could not be shown">Refresh to try again; the agent itself is not affected.</EmptyState>}>
          <AgentChat
            agent={agent}
            messages={conversation}
            truncated={false}
            onLoadEarlier={canLoadEarlier && !needle ? loadEarlier : null}
            loadingEarlier={earlier.loading}
            send={chatSend}
            sendNote={route.canSend ? route.how : route.why}
            working={agent.live && agent.state === 'working'}
          />
        </ChatBoundary>
      ) : (
        <ScrollArea ref={ref} style={{ flex: 1, minHeight: 200 }} label="Agent output">
          <div className="af-log">{lines.length ? lines.map((line, i) => <div key={i} className="line">{line || ' '}</div>) : <span className="af-muted">{needle ? 'No lines match.' : 'No output yet.'}</span>}</div>
        </ScrollArea>
      )}
      </div>
      {output.kind === 'conversation' ? null : <ChatComposer agent={agent} send={chatSend} note={route.canSend ? route.how : route.why} />}
    </div>
  )
}

/** Older batch first, newer after; a message present in both shows once. */
function mergeMessages(older: ConversationMessage[], newer: ConversationMessage[]): ConversationMessage[] {
  if (!older.length) return newer
  const seen = new Set(newer.map((m) => m.id))
  return [...older.filter((m) => !seen.has(m.id)), ...newer]
}
