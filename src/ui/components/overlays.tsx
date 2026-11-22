// Dialog, context menu, toasts and resize handle.
import * as RDialog from '@radix-ui/react-dialog'
import { ScrollArea } from './ui/ScrollArea.tsx'
import { useState, type ReactNode } from 'react'
import { Button } from './primitives.tsx'
import { Icon } from './Icon.tsx'
import { MenuAt, type MenuEntry } from './ui/Menu.tsx'

export function Dialog({ title, children, footer, onClose, wide }: { title: string; children: ReactNode; footer?: ReactNode; onClose: () => void; wide?: boolean }) {
  // Radix Dialog: focus trap, Esc and outside click close, focus returns to the opener.
  return (
    <RDialog.Root open onOpenChange={(open) => !open && onClose()}>
      <RDialog.Portal>
        <RDialog.Overlay className="af-overlay" />
        <RDialog.Content
          className={`af-dialog${wide ? ' wide' : ''}`}
          aria-describedby={undefined}
          onOpenAutoFocus={(event) => {
            // Start in the first field (or the main button), not on the close button.
            const target = (event.currentTarget as HTMLElement).querySelector<HTMLElement>('.body input, .body textarea, .body button.af-ui-select, footer button.primary')
            if (target) {
              event.preventDefault()
              target.focus()
            }
          }}
        >
          <header>
            <RDialog.Title className="af-dialog-title">{title}</RDialog.Title>
            <RDialog.Close asChild>
              <button className="af-btn ghost icon sm" aria-label="Close">
                <Icon name="close" size={14} />
              </button>
            </RDialog.Close>
          </header>
          <ScrollArea className="af-dialog-scroll">
            <div className="body">{children}</div>
          </ScrollArea>
          {footer ? <footer>{footer}</footer> : null}
        </RDialog.Content>
      </RDialog.Portal>
    </RDialog.Root>
  )
}

export function ConfirmDialog({ title, message, confirmLabel, danger, onConfirm, onCancel }: { title: string; message: ReactNode; confirmLabel: string; danger?: boolean; onConfirm: () => void; onCancel: () => void }) {
  return (
    <Dialog
      title={title}
      onClose={onCancel}
      footer={
        <>
          <Button onClick={onCancel}>Cancel</Button>
          <Button variant={danger ? 'danger' : 'primary'} className={danger ? '' : 'primary'} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div>{message}</div>
    </Dialog>
  )
}

export type MenuItem = MenuEntry

/** Right-click menu at a pointer position (Radix DropdownMenu anchored to that point). */
export function ContextMenu({ x, y, items, onClose }: { x: number; y: number; items: MenuItem[]; onClose: () => void }) {
  return <MenuAt x={x} y={y} items={items} onClose={onClose} />
}

export type Toast = { id: number; tone: 'running' | 'done' | 'failed' | 'blocked'; text: string }

export function Toasts({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: number) => void }) {
  return (
    <div className="af-toasts" aria-live="polite">
      {toasts.map((toast) => (
        <div key={toast.id} className="af-toast" data-status={toast.tone === 'running' ? 'running' : toast.tone} role="status">
          <div style={{ display: 'flex', gap: 8, alignItems: 'start' }}>
            <span style={{ flex: 1 }}>{toast.text}</span>
            <button className="af-btn ghost icon sm" aria-label="Dismiss" onClick={() => onDismiss(toast.id)}>
              <Icon name="close" size={12} />
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}

/** Drag handle that reports the new size; `edge` says which side of the panel it sits on. */
export function ResizeHandle({ direction, onResize, getSize, invert = false, min = 160, max = 900 }: { direction: 'v' | 'h'; onResize: (size: number) => void; getSize: () => number; invert?: boolean; min?: number; max?: number }) {
  const [dragging, setDragging] = useState(false)
  const onPointerDown = (event: React.PointerEvent) => {
    event.preventDefault()
    const start = direction === 'v' ? event.clientX : event.clientY
    const startSize = getSize()
    setDragging(true)
    const move = (e: PointerEvent) => {
      const delta = (direction === 'v' ? e.clientX : e.clientY) - start
      onResize(Math.max(min, Math.min(max, startSize + (invert ? -delta : delta))))
    }
    const up = () => {
      setDragging(false)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }
  return <div className={`af-resize ${direction} ${dragging ? 'dragging' : ''}`} role="separator" aria-orientation={direction === 'v' ? 'vertical' : 'horizontal'} onPointerDown={onPointerDown} />
}
