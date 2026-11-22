// Single-choice dropdown built on Radix Select: keyboard navigation, typeahead, scrolling list,
// themed popover. Replaces native <select> everywhere.
import * as RS from '@radix-ui/react-select'
import type { CSSProperties, ReactNode } from 'react'
import { Icon } from '../Icon.tsx'

export type SelectOption = { value: string; label: string; hint?: string; dot?: 'live' | 'muted' | null; icon?: ReactNode }

/** Radix reserves the empty string; an empty value is stored under this key instead. */
const EMPTY = '__af_empty__'
const encode = (value: string) => (value === '' ? EMPTY : value)
const decode = (value: string) => (value === EMPTY ? '' : value)

export function Select({ value, onChange, options, ariaLabel, disabled, style, placeholder }: { value: string; onChange: (value: string) => void; options: SelectOption[]; ariaLabel: string; disabled?: boolean; style?: CSSProperties; placeholder?: string }) {
  const current = options.find((o) => o.value === value)
  return (
    <RS.Root value={encode(value)} onValueChange={(v) => onChange(decode(v))} disabled={disabled}>
      <RS.Trigger className="af-ui-select" aria-label={ariaLabel} style={style} title={current?.label}>
        {current?.dot ? <span className={`af-ui-dot ${current.dot}`} /> : null}
        <span className="af-ui-select-value">
          <RS.Value placeholder={placeholder ?? 'Choose…'}>{current?.label}</RS.Value>
        </span>
        <RS.Icon className="af-ui-select-chevron">
          <Icon name="down" size={14} />
        </RS.Icon>
      </RS.Trigger>
      <RS.Portal>
        <RS.Content className="af-ui-popover af-ui-select-content" position="popper" sideOffset={4} collisionPadding={8}>
          <RS.ScrollUpButton className="af-ui-scroll">
            <Icon name="down" size={12} style={{ transform: 'rotate(180deg)' }} />
          </RS.ScrollUpButton>
          <RS.Viewport className="af-ui-select-viewport">
            {options.map((option) => (
              <RS.Item key={option.value} value={encode(option.value)} className="af-ui-item" textValue={option.label}>
                <span className="af-ui-item-lead">{option.dot ? <span className={`af-ui-dot ${option.dot}`} /> : option.icon ?? null}</span>
                <span className="af-ui-item-text">
                  <RS.ItemText>{option.label}</RS.ItemText>
                  {option.hint ? <span className="af-ui-item-hint">{option.hint}</span> : null}
                </span>
                <RS.ItemIndicator className="af-ui-item-check">
                  <Icon name="task" size={13} />
                </RS.ItemIndicator>
              </RS.Item>
            ))}
          </RS.Viewport>
          <RS.ScrollDownButton className="af-ui-scroll">
            <Icon name="down" size={12} />
          </RS.ScrollDownButton>
        </RS.Content>
      </RS.Portal>
    </RS.Root>
  )
}
