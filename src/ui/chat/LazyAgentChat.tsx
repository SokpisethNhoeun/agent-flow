// The chat view loads on first use: assistant-ui and the markdown stack are about half of the
// UI code, and the canvas should not wait for them.
import { lazy, Suspense, type ComponentProps } from 'react'

const AgentChatImpl = lazy(() => import('./AgentChat.tsx').then((m) => ({ default: m.AgentChat })))

export type AgentChatProps = ComponentProps<typeof AgentChatImpl>

export function AgentChat(props: AgentChatProps) {
  return (
    <Suspense fallback={<div className="af-empty">Loading chat…</div>}>
      <AgentChatImpl {...props} />
    </Suspense>
  )
}

/** Starts loading the chat code early (e.g. when an agent is selected), without rendering it. */
export function preloadChat(): void {
  void import('./AgentChat.tsx')
}
