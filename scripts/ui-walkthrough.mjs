#!/usr/bin/env node
// Click-by-click UI walkthrough of the real Agent Flow browser dashboard, driven through Orca's
// built-in browser. Takes a screenshot after every step, checks what the step should have changed,
// and writes test-results/walkthrough/report.html (gitignored).
//
// Usage: node scripts/ui-walkthrough.mjs [--page <browserPageId>] [--width 1400] [--height 860]
// Needs: the dashboard on in Agent Flow settings and a tab open at http://127.0.0.1:<port>/ in Orca.
// Read-only by design; `npm run test:ui:fixture` covers the controls against test data.
import { join } from 'node:path'
import { createBrowser, orcaCli, prepare, sleep } from './walkthrough/browser.mjs'
import { liveSteps } from './walkthrough/live-steps.mjs'
import { runSteps, writeReport } from './walkthrough/run-steps.mjs'

const orca = orcaCli()
const args = Object.fromEntries(process.argv.slice(2).reduce((acc, v, i, all) => (v.startsWith('--') ? [...acc, [v.slice(2), all[i + 1]]] : acc), []))
const OUT = join(process.cwd(), 'test-results', 'walkthrough')

// Prefer the visible tab: a background tab does not draw frames, so it cannot be screenshotted.
const tab = [...orca(['tab', 'list']).tabs].sort((a, b) => Number(b.active) - Number(a.active)).find((t) => (args.page ? t.browserPageId === args.page : /^http:\/\/127\.0\.0\.1:\d+\/$/.test(t.url) && t.title === 'Agent Flow'))
if (!tab?.browserPageId) {
  console.error('No Agent Flow dashboard tab found in Orca’s browser. Open the dashboard first.')
  process.exit(2)
}

// Orca reloads a development plugin when its files change; wait until the dashboard answers.
const origin = new URL(tab.url).origin
for (let i = 0; ; i++) {
  if (await fetch(origin + '/').then((r) => r.ok, () => false)) break
  if (i > 30) throw new Error(`The dashboard at ${origin} does not answer.`)
  await sleep(1000)
}

const browser = createBrowser(orca, tab.browserPageId)
await prepare(orca, browser, { width: Number(args.width ?? 1400), height: Number(args.height ?? 860) })
const outcome = await runSteps(browser, liveSteps(browser), OUT)
writeReport(OUT, 'Agent Flow — click-by-click walkthrough', outcome)
process.exit(outcome.failed ? 1 : 0)
