// WCAG contrast of the theme's own fallback colors (the browser dashboard; inside Orca, Orca's
// theme supplies the neutrals). Text needs 4.5:1, status dots, borders and edges 3:1.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const css = readFileSync(new URL('../src/ui/styles/app.css', import.meta.url), 'utf8')
const darkStart = css.indexOf('@media (prefers-color-scheme: dark)')

function tokens(block: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const m of block.matchAll(/--(af-[a-z-]+):\s*(?:var\(--orca-[a-z-]+,\s*)?(#[0-9a-f]{6})/gi)) out[m[1]] = m[2].toLowerCase()
  return out
}
const light = tokens(css.slice(0, darkStart))
const dark = { ...light, ...tokens(css.slice(darkStart, css.indexOf('}\n}', darkStart))) }

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

const STATUSES = ['running', 'review', 'blocked', 'failed', 'done', 'ready', 'cancelled', 'waiting']

for (const [name, theme] of [['light', light], ['dark', dark]] as const) {
  test(`${name}: status text colors are readable on cards (4.5:1)`, () => {
    for (const status of STATUSES) {
      const fg = theme[`af-${status}-text`]
      assert.ok(fg, `missing --af-${status}-text`)
      const ratio = contrast(fg, theme['af-card'])
      assert.ok(ratio >= 4.5, `${name} ${status} text ${fg} on ${theme['af-card']}: ${ratio.toFixed(2)}`)
    }
  })
  test(`${name}: status dots, borders and edges stand out (3:1)`, () => {
    for (const status of STATUSES) {
      const ratio = contrast(theme[`af-${status}`], theme['af-card'])
      assert.ok(ratio >= 3, `${name} ${status} ${theme[`af-${status}`]} on card: ${ratio.toFixed(2)}`)
    }
  })
  test(`${name}: body and muted text are readable`, () => {
    for (const bg of ['af-bg', 'af-card', 'af-popover']) {
      assert.ok(contrast(theme['af-fg'], theme[bg]) >= 4.5, `fg on ${bg}`)
      assert.ok(contrast(theme['af-muted-fg'], theme[bg]) >= 4.5, `muted on ${bg}: ${contrast(theme['af-muted-fg'], theme[bg]).toFixed(2)}`)
    }
  })
}
