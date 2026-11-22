// Scrollable areas with Radix Scroll Area: thin themed scrollbars that show while scrolling or on
// hover; wheel, touch and keyboard scrolling stay native. `asChild` makes another component's
// element the scroller (the chat thread keeps its own auto-scroll that way).
import * as RScroll from '@radix-ui/react-scroll-area'
import { forwardRef, type CSSProperties, type ReactNode } from 'react'

type Props = {
  children: ReactNode
  className?: string
  viewportClassName?: string
  style?: CSSProperties
  /** Also scroll sideways (wide logs, tables). */
  horizontal?: boolean
  /** The single child element becomes the scrolling viewport. */
  asChild?: boolean
  label?: string
}

export const ScrollArea = forwardRef<HTMLDivElement, Props>(function ScrollArea({ children, className, viewportClassName, style, horizontal, asChild, label }, viewportRef) {
  return (
    <RScroll.Root type="hover" scrollHideDelay={700} className={`af-ui-scroll ${className ?? ''}`} style={style}>
      <RScroll.Viewport ref={viewportRef} asChild={asChild} className={`af-ui-scroll-viewport ${viewportClassName ?? ''}`} aria-label={label} tabIndex={label ? 0 : undefined}>
        {children}
      </RScroll.Viewport>
      <RScroll.Scrollbar orientation="vertical" className="af-ui-scrollbar">
        <RScroll.Thumb className="af-ui-scroll-thumb" />
      </RScroll.Scrollbar>
      {horizontal ? (
        <RScroll.Scrollbar orientation="horizontal" className="af-ui-scrollbar">
          <RScroll.Thumb className="af-ui-scroll-thumb" />
        </RScroll.Scrollbar>
      ) : null}
      <RScroll.Corner />
    </RScroll.Root>
  )
})
