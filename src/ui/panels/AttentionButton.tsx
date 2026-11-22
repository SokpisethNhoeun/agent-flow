// Toolbar button that counts what needs the person (blocked agents, open decisions, recent
// failures) and jumps to each one: selects it, opens the inspector and centers it on the canvas.
import { forwardRef, useMemo, type ComponentPropsWithoutRef } from 'react'
import { Icon, type IconName } from '../components/Icon.tsx'
import { timeAgo, useNow } from '../components/primitives.tsx'
import { Menu } from '../components/ui/Menu.tsx'
import { attentionItems, type AttentionKind } from '../graph/attention.ts'
import { useApp, useFlowView } from '../state/app-context.tsx'
import { requestFocus } from '../state/focus.ts'

const ICON: Record<AttentionKind, IconName> = { blocked: 'alert', gate: 'task', 'failed-task': 'block', 'failed-agent': 'block' }
const TONE: Record<AttentionKind, string> = { blocked: 'blocked', gate: 'review', 'failed-task': 'failed', 'failed-agent': 'failed' }

const AttentionTrigger = forwardRef<HTMLButtonElement, ComponentPropsWithoutRef<'button'> & { count: number; urgent: boolean }>(function AttentionTrigger({ count, urgent, ...rest }, ref) {
  return (
    // The visible "need you" text is hidden on narrow toolbars; the accessible name always says it.
    <button ref={ref} type="button" aria-label={`${count} need${count > 1 ? '' : 's'} you`} className={`af-attention-btn ${urgent ? 'urgent' : ''}`} title={`${count} item${count > 1 ? 's' : ''} need${count > 1 ? '' : 's'} your attention`} {...rest}>
      <Icon name="alert" size={13} />
      <span>{count}</span>
      <span className="af-attention-label">need{count > 1 ? '' : 's'} you</span>
    </button>
  )
})

export function AttentionButton() {
  const { viewStore } = useApp()
  const flow = useFlowView()
  const now = useNow(true, 30_000)
  const items = useMemo(() => (flow.mode === 'live' ? attentionItems(flow.state, now) : []), [flow.state, flow.mode, now])
  if (!items.length) return null
  const urgent = items.some((item) => item.kind === 'blocked' || item.kind === 'gate')
  return (
    <Menu
      wide
      label="Needs your attention"
      trigger={<AttentionTrigger count={items.length} urgent={urgent} />}
      items={items.slice(0, 30).map((item) => ({
        label: item.title,
        description: item.detail,
        meta: item.since ? timeAgo(item.since, now) : undefined,
        icon: ICON[item.kind],
        status: TONE[item.kind],
        onSelect: () => {
          // Failures are not "active": show everything so the card is on the canvas.
          if (item.kind === 'failed-task' || item.kind === 'failed-agent') viewStore.setFilters({ activeOnly: false })
          viewStore.set({ selectedId: item.selectId, panels: { ...viewStore.get().panels, right: true } })
          requestFocus(item.selectId)
        }
      }))}
    />
  )
}
