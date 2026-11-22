// Where to point the canvas camera. Fits everything when that stays readable; otherwise shows the
// cards that matter (working, blocked, failed) at a readable size, starting where the flow starts.
export type Rect = { x: number; y: number; width: number; height: number }
export type Viewport = { x: number; y: number; zoom: number }

export const READABLE_ZOOM = 0.75
const MAX_ZOOM = 1.1
const PAD = 24

export function planViewport(whole: Rect, focus: Rect | null, size: { width: number; height: number }): Viewport {
  const room = { width: Math.max(1, size.width - 2 * PAD), height: Math.max(1, size.height - 2 * PAD) }
  const fitZoom = (r: Rect) => Math.min(MAX_ZOOM, room.width / Math.max(1, r.width), room.height / Math.max(1, r.height))
  const wholeZoom = fitZoom(whole)
  const useFocus = wholeZoom < READABLE_ZOOM && focus
  const target = useFocus ? focus : whole
  const zoom = useFocus ? Math.max(READABLE_ZOOM, fitZoom(focus)) : Math.max(0.1, wholeZoom)
  // Center each axis that fits; otherwise start at the top / left edge.
  const axis = (start: number, length: number, available: number) => (length * zoom <= available ? PAD + (available - length * zoom) / 2 - start * zoom : PAD - start * zoom)
  return { x: axis(target.x, target.width, room.width), y: axis(target.y, target.height, room.height), zoom }
}
