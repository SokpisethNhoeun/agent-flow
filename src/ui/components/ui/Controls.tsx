// Small Radix-based controls: tooltip, tabs strip, segmented toggle, switch.
import * as RSwitch from '@radix-ui/react-switch'
import * as RTabs from '@radix-ui/react-tabs'
import * as RToggle from '@radix-ui/react-toggle-group'
import * as RTooltip from '@radix-ui/react-tooltip'
import type { ReactElement, ReactNode } from 'react'
import { Icon, type IconName } from '../Icon.tsx'

export function TooltipProvider({ children }: { children: ReactNode }) {
  return (
    <RTooltip.Provider delayDuration={350} skipDelayDuration={150}>
      {children}
    </RTooltip.Provider>
  )
}

/** Hover / focus hint. The child must accept a ref (a button or element). */
export function Tip({ content, children, side = 'bottom' }: { content: ReactNode; children: ReactElement; side?: 'top' | 'bottom' | 'left' | 'right' }) {
  if (!content) return children
  return (
    <RTooltip.Root>
      <RTooltip.Trigger asChild>{children}</RTooltip.Trigger>
      <RTooltip.Portal>
        <RTooltip.Content className="af-ui-tooltip" side={side} sideOffset={6} collisionPadding={8}>
          {content}
        </RTooltip.Content>
      </RTooltip.Portal>
    </RTooltip.Root>
  )
}

export type TabSpec<T extends string> = { id: T; label: string; icon?: IconName; title?: string; badge?: number }

/** Tab strip (content is rendered by the caller); arrow keys move between tabs. */
export function TabStrip<T extends string>({ tabs, value, onChange, fill }: { tabs: TabSpec<T>[]; value: T; onChange: (id: T) => void; fill?: boolean }) {
  return (
    <RTabs.Root value={value} onValueChange={(v) => onChange(v as T)} activationMode="manual">
      <RTabs.List className={`af-tabs ${fill ? 'fill' : ''}`}>
        {tabs.map((tab) => (
          <RTabs.Trigger key={tab.id} value={tab.id} title={tab.title ?? tab.label}>
            {tab.icon ? <Icon name={tab.icon} size={13} /> : null}
            <span>{tab.label}</span>
            {tab.badge ? <span className="af-chip" style={{ marginLeft: 6 }}>{tab.badge}</span> : null}
          </RTabs.Trigger>
        ))}
      </RTabs.List>
    </RTabs.Root>
  )
}

/** One-of-N toggle (view mode, Active/All…). */
export function Segmented<T extends string>({ value, onChange, options, ariaLabel }: { value: T; onChange: (value: T) => void; options: { value: T; label: string; title?: string }[]; ariaLabel: string }) {
  return (
    <RToggle.Root type="single" className="af-seg" aria-label={ariaLabel} value={value} onValueChange={(v) => v && onChange(v as T)}>
      {options.map((option) => (
        <RToggle.Item key={option.value} value={option.value} title={option.title} aria-pressed={option.value === value}>
          {option.label}
        </RToggle.Item>
      ))}
    </RToggle.Root>
  )
}

export function Switch({ checked, onChange, label, title }: { checked: boolean; onChange: (checked: boolean) => void; label: string; title?: string }) {
  return (
    <label className="af-ui-switch-row" title={title}>
      <RSwitch.Root className="af-ui-switch" checked={checked} onCheckedChange={onChange}>
        <RSwitch.Thumb className="af-ui-switch-thumb" />
      </RSwitch.Root>
      <span>{label}</span>
    </label>
  )
}
