// Menus built on Radix DropdownMenu: a button menu, a menu opened at a pointer position (canvas
// right-click), and a multi-choice picker with checkboxes.
import * as DM from '@radix-ui/react-dropdown-menu'
import type { ReactNode } from 'react'
import { Icon, type IconName } from '../Icon.tsx'

export type MenuEntry =
  | {
      label: string
      icon?: IconName
      onSelect?: () => void
      disabled?: boolean
      title?: string
      danger?: boolean
      /** Second line under the label. */
      description?: string
      /** Right-aligned note, e.g. "5m ago". */
      meta?: string
      /** Status color for the icon (data-status). */
      status?: string
    }
  | 'separator'

function Entries({ items }: { items: MenuEntry[] }) {
  return (
    <>
      {items.map((item, index) =>
        item === 'separator' ? (
          <DM.Separator key={`sep-${index}`} className="af-ui-separator" />
        ) : (
          <DM.Item key={`${item.label}-${index}`} className={`af-ui-item ${item.danger ? 'danger' : ''} ${item.description ? 'rich' : ''}`} disabled={item.disabled} title={item.title} onSelect={() => item.onSelect?.()} data-status={item.status}>
            <span className="af-ui-item-lead">{item.icon ? <Icon name={item.icon} size={14} /> : null}</span>
            <span className="af-ui-item-text">
              <span className="af-ui-item-label">{item.label}</span>
              {item.description ? <span className="af-ui-item-hint">{item.description}</span> : null}
            </span>
            {item.meta ? <span className="af-ui-item-meta">{item.meta}</span> : null}
          </DM.Item>
        )
      )}
    </>
  )
}

export function Menu({ trigger, items, label, align = 'start', open, onOpenChange, wide }: { trigger: ReactNode; items: MenuEntry[]; label?: string; align?: 'start' | 'end'; open?: boolean; onOpenChange?: (open: boolean) => void; wide?: boolean }) {
  return (
    <DM.Root open={open} onOpenChange={onOpenChange}>
      <DM.Trigger asChild>{trigger}</DM.Trigger>
      <DM.Portal>
        <DM.Content className={`af-ui-popover af-ui-menu ${wide ? 'wide' : ''}`} align={align} sideOffset={6} collisionPadding={8}>
          {label ? <DM.Label className="af-ui-label">{label}</DM.Label> : null}
          <Entries items={items} />
        </DM.Content>
      </DM.Portal>
    </DM.Root>
  )
}

/** A menu that opens at a pointer position (right-click), anchored to an invisible point. */
export function MenuAt({ x, y, items, onClose }: { x: number; y: number; items: MenuEntry[]; onClose: () => void }) {
  return (
    <DM.Root open modal={false} onOpenChange={(open) => !open && onClose()}>
      <DM.Trigger asChild>
        <span aria-hidden style={{ position: 'fixed', left: x, top: y, width: 0, height: 0 }} />
      </DM.Trigger>
      <DM.Portal>
        <DM.Content className="af-ui-popover af-ui-menu" align="start" side="bottom" sideOffset={2} collisionPadding={8} onCloseAutoFocus={(e) => e.preventDefault()}>
          <Entries items={items} />
        </DM.Content>
      </DM.Portal>
    </DM.Root>
  )
}

/** Pick several values (e.g. task dependencies). */
export function MultiSelect({ values, onChange, options, ariaLabel, placeholder }: { values: string[]; onChange: (values: string[]) => void; options: { value: string; label: string }[]; ariaLabel: string; placeholder: string }) {
  const chosen = options.filter((o) => values.includes(o.value))
  return (
    <DM.Root>
      <DM.Trigger className="af-ui-select" aria-label={ariaLabel}>
        <span className="af-ui-select-value">{chosen.length ? chosen.map((o) => o.label).join(', ') : <span className="af-muted">{placeholder}</span>}</span>
        {chosen.length ? <span className="af-chip">{chosen.length}</span> : null}
        <Icon name="down" size={14} />
      </DM.Trigger>
      <DM.Portal>
        <DM.Content className="af-ui-popover af-ui-menu wide" align="start" sideOffset={4} collisionPadding={8}>
          {options.length ? (
            options.map((option) => (
              <DM.CheckboxItem
                key={option.value}
                className="af-ui-item"
                checked={values.includes(option.value)}
                onCheckedChange={(checked) => onChange(checked ? [...values, option.value] : values.filter((v) => v !== option.value))}
                onSelect={(e) => e.preventDefault()}
              >
                <span className="af-ui-item-lead">
                  <DM.ItemIndicator>
                    <Icon name="task" size={13} />
                  </DM.ItemIndicator>
                </span>
                <span className="af-ui-item-text">{option.label}</span>
              </DM.CheckboxItem>
            ))
          ) : (
            <div className="af-ui-empty">Nothing to choose</div>
          )}
        </DM.Content>
      </DM.Portal>
    </DM.Root>
  )
}
