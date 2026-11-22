// Arrow-key navigation between cards by where they are on the canvas: the nearest card in the
// pressed direction, preferring ones in line with the current card over ones far to the side.

export type Box = { id: string; x: number; y: number; width: number; height: number }
export type Direction = 'left' | 'right' | 'up' | 'down'

export function nextInDirection(from: Box, boxes: Box[], direction: Direction): string | null {
  const cx = from.x + from.width / 2
  const cy = from.y + from.height / 2
  let best: { id: string; score: number } | null = null
  for (const box of boxes) {
    if (box.id === from.id) continue
    const bx = box.x + box.width / 2
    const by = box.y + box.height / 2
    const dx = bx - cx
    const dy = by - cy
    // Along: distance in the pressed direction (must be ahead). Across: how far off the line it is.
    const along = direction === 'right' ? dx : direction === 'left' ? -dx : direction === 'down' ? dy : -dy
    const across = direction === 'left' || direction === 'right' ? Math.abs(dy) : Math.abs(dx)
    if (along <= 1) continue
    const score = along + across * 2
    if (!best || score < best.score) best = { id: box.id, score }
  }
  return best?.id ?? null
}

/** The card to start from when nothing is selected: the leftmost (trees grow left to right, so the root), then topmost. */
export function firstBox(boxes: Box[]): string | null {
  let best: Box | null = null
  for (const box of boxes) if (!best || box.x + box.y * 0.5 < best.x + best.y * 0.5) best = box
  return best?.id ?? null
}
