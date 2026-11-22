// Highlights every occurrence of a query inside a container with the CSS Custom Highlight API:
// no DOM changes, so it works over the chat's own rendering. Re-runs as the content changes.
import { useEffect, type RefObject } from 'react'

const NAME = 'af-find'
const MAX_RANGES = 1000

type HighlightRegistry = { set(name: string, value: unknown): void; delete(name: string): void }
type HighlightCtor = new (...ranges: Range[]) => unknown

function registry(): { highlights: HighlightRegistry; Highlight: HighlightCtor } | null {
  const css = (globalThis as { CSS?: { highlights?: HighlightRegistry } }).CSS
  const Highlight = (globalThis as { Highlight?: HighlightCtor }).Highlight
  return css?.highlights && Highlight ? { highlights: css.highlights, Highlight } : null
}

export function useTextHighlight(container: RefObject<HTMLElement | null>, query: string): void {
  useEffect(() => {
    const api = registry()
    const root = container.current
    const needle = query.trim().toLowerCase()
    if (!api || !root || !needle) {
      api?.highlights.delete(NAME)
      return
    }
    const paint = () => {
      const ranges: Range[] = []
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
      for (let node = walker.nextNode(); node && ranges.length < MAX_RANGES; node = walker.nextNode()) {
        const text = node.nodeValue?.toLowerCase() ?? ''
        for (let i = text.indexOf(needle); i >= 0 && ranges.length < MAX_RANGES; i = text.indexOf(needle, i + needle.length)) {
          const range = document.createRange()
          range.setStart(node, i)
          range.setEnd(node, i + needle.length)
          ranges.push(range)
        }
      }
      api.highlights.set(NAME, new api.Highlight(...ranges))
    }
    paint()
    let timer: ReturnType<typeof setTimeout> | null = null
    const observer = new MutationObserver(() => {
      if (timer) return
      timer = setTimeout(() => {
        timer = null
        paint()
      }, 120)
    })
    observer.observe(root, { subtree: true, childList: true, characterData: true })
    return () => {
      observer.disconnect()
      if (timer) clearTimeout(timer)
      api.highlights.delete(NAME)
    }
  }, [container, query])
}
