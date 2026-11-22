// Reusable UI primitives shared by every panel.
import { memo, useEffect, useState, type ButtonHTMLAttributes, type ReactNode } from 'react'
import type { VisualStatus } from '../graph/types.ts'
import { formatDuration, STATUS_LABEL } from '../graph/status.ts'
import { Icon, type IconName } from './Icon.tsx'
import { TabStrip, Tip, type TabSpec } from './ui/Controls.tsx'

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'default' | 'primary' | 'danger' | 'ghost'; size?: 'sm' | 'md'; icon?: IconName; iconOnly?: boolean }

export function Button({ variant = 'default', size = 'md', icon, iconOnly, className, children, title, ...rest }: ButtonProps) {
  const classes = ['af-btn', variant !== 'default' ? variant : '', size === 'sm' ? 'sm' : '', iconOnly ? 'icon' : '', className ?? ''].filter(Boolean).join(' ')
  const button = (
    <button type="button" className={classes} aria-label={iconOnly ? (rest['aria-label'] ?? title) : rest['aria-label']} title={iconOnly && !rest.disabled ? undefined : title} {...rest}>
      {icon ? <Icon name={icon} size={size === 'sm' ? 13 : 15} /> : null}
      {iconOnly ? null : children}
    </button>
  )
  // Icon-only buttons explain themselves with a styled tooltip (disabled ones keep the native title).
  return iconOnly && title && !rest.disabled ? <Tip content={title}>{button}</Tip> : button
}

export function Chip({ children, tone, title }: { children: ReactNode; tone?: 'muted' | 'accent' | 'warning' | 'danger' | 'success'; title?: string }) {
  return (
    <span className={`af-chip ${tone && tone !== 'muted' ? tone : ''}`} title={title ?? (typeof children === 'string' ? children : undefined)}>
      {children}
    </span>
  )
}

export function StatusDot({ status, live }: { status: VisualStatus; live?: boolean }) {
  return <span className={`af-dot ${live && status === 'running' ? 'pulse' : ''}`} data-status={status} title={STATUS_LABEL[status]} />
}

export function StatusText({ status }: { status: VisualStatus }) {
  return (
    <span data-status={status} style={{ color: 'var(--st)', fontWeight: 600 }}>
      {STATUS_LABEL[status]}
    </span>
  )
}

/** Shows a value, or a clear "not available" marker; never invents a placeholder value. */
export function Value({ children, unavailable = 'Not available from Orca' }: { children: ReactNode; unavailable?: string }) {
  if (children === null || children === undefined || children === '') return <span className="af-unavailable">{unavailable}</span>
  return <>{children}</>
}

/** Tab strip on Radix Tabs (arrow keys, roles); the caller renders the content. */
export function Tabs<T extends string>(props: { tabs: TabSpec<T>[]; value: T; onChange: (id: T) => void; fill?: boolean }) {
  return <TabStrip {...props} />
}

export function EmptyState({ icon = 'flow', title, children }: { icon?: IconName; title: string; children?: ReactNode }) {
  return (
    <div className="af-empty">
      <Icon name={icon} size={28} />
      <h3>{title}</h3>
      {children ? <div style={{ maxWidth: 420 }}>{children}</div> : null}
    </div>
  )
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="af-field">
      <span>{label}</span>
      {children}
    </label>
  )
}

/** One shared 1 s clock, so many timers re-render together. */
let clockListeners = new Set<(now: number) => void>()
let clockTimer: ReturnType<typeof setInterval> | null = null
/**
 * The current time, rounded down to `step` ms. A component re-renders only when the rounded
 * value changes, so a 2 s step costs half the renders of the 1 s clock.
 */
export function useNow(active = true, step = 1000): number {
  const [now, setNow] = useState(() => Math.floor(Date.now() / step) * step)
  useEffect(() => {
    if (!active) return
    const listener = (t: number) => setNow(Math.floor(t / step) * step)
    clockListeners.add(listener)
    if (!clockTimer) clockTimer = setInterval(() => clockListeners.forEach((fn) => fn(Date.now())), 1000)
    return () => {
      clockListeners.delete(listener)
      if (!clockListeners.size && clockTimer) {
        clearInterval(clockTimer)
        clockTimer = null
        clockListeners = new Set()
      }
    }
  }, [active, step])
  return now
}

export const Duration = memo(function Duration({ since, until }: { since: number | null; until: number | null }) {
  const now = useNow(since !== null && until === null)
  if (since === null) return null
  return <span title={new Date(since).toLocaleString()}>{formatDuration((until ?? now) - since)}</span>
})

export function timeAgo(ts: number, now = Date.now()): string {
  const diff = now - ts
  if (diff < 5000) return 'just now'
  return `${formatDuration(diff)} ago`
}

export function clock(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

/** True when a key event is aimed at a text field (shortcuts must not fire there). Safe for events whose target is the window or document. */
export function isTypingTarget(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest('input, textarea, select, [contenteditable]'))
}
