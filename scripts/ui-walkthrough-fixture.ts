// Click-by-click walkthrough of the controls against test data: starts a stand-in dashboard server
// (real built UI, test data, every command recorded), opens it in a new Orca browser tab, clicks
// through batch actions, chat send, live output, find, run totals and run comparison, takes a
// screenshot after every step, then closes the tab and the server. Nothing reaches Orca or an agent.
//
// Usage: npm run test:ui:fixture [-- --keep]   (--keep: leave the server running to explore)
import { join } from 'node:path'
import { createBrowser, orcaCli, prepare, sleep } from './walkthrough/browser.mjs'
import { compactSteps, fixtureSteps } from './walkthrough/fixture-steps.ts'
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import type { Recorded } from './walkthrough/fixture-server.ts'
import { runSteps, writeReport } from './walkthrough/run-steps.mjs'

const orca = orcaCli()
const OUT = join(process.cwd(), 'test-results', 'walkthrough-fixture')
const child = spawn(process.execPath, ['--import', 'tsx', 'scripts/walkthrough/fixture-server-main.ts'], { stdio: ['pipe', 'pipe', 'inherit'] })
const address = await new Promise<{ origin: string; url: string }>((resolve, reject) => {
  createInterface({ input: child.stdout! }).once('line', (line) => resolve(JSON.parse(line)))
  child.once('exit', (code) => reject(new Error(`The stand-in server exited (${code}).`)))
})
// The steps read what the UI sent, and make the live worker "write", over the server's test endpoints.
let recorded: Recorded[] = []
const server = {
  ...address,
  get commands() {
    return recorded
  },
  refresh: async () => {
    recorded = (await (await fetch(`${address.origin}/__test/commands`)).json()) as Recorded[]
  },
  streamReply: (text: string) => void fetch(`${address.origin}/__test/reply`, { method: 'POST', body: JSON.stringify({ text }) }),
  /** Every live agent goes idle, or comes back to work (one live update each). */
  grow: async (n: number) => void (await fetch(`${address.origin}/__test/grow?n=${n}`, { method: 'POST' })),
  setAgentState: async (id: string, state: string) => void (await fetch(`${address.origin}/__test/agent-state?id=${id}&state=${state}`, { method: 'POST' })),
  setLive: async (live: boolean) => void (await fetch(`${address.origin}/__test/${live ? 'live' : 'idle'}`, { method: 'POST' })),
  stop: async () => {
    child.stdin!.end()
    await new Promise((resolve) => child.once('exit', resolve))
  }
}
console.log(`Stand-in dashboard (test data): ${server.origin}`)

const before = new Set(orca(['tab', 'list']).tabs.map((t: { browserPageId: string }) => t.browserPageId))
orca(['tab', 'create', '--url', server.url])
let page: string | undefined
for (let i = 0; i < 40 && !page; i++) {
  page = orca(['tab', 'list']).tabs.find((t: { browserPageId: string }) => !before.has(t.browserPageId))?.browserPageId
  if (!page) await sleep(250)
}
if (!page) throw new Error('The new browser tab did not appear.')
// `tab create --url` may leave the tab blank; navigate it explicitly.
orca(['goto', '--page', page, '--url', server.url])
if (process.argv.includes('--keep')) {
  console.log(`Tab ${page} open; press Ctrl+C to stop the server.`)
  await new Promise(() => undefined)
}

const browser = createBrowser(orca, page)
let failed = 1
try {
  await prepare(orca, browser, { reload: false })
  const outcome = await runSteps(browser, fixtureSteps(browser, server), OUT)
  writeReport(OUT, 'Agent Flow — controls walkthrough (test data)', outcome)
  failed = outcome.failed
  // The compact layout at the widths people really use: Orca's side panel, a small window, a phone.
  for (const [width, height, label] of [[420, 860, 'panel'], [760, 900, 'small-window'], [390, 844, 'phone']] as const) {
    console.log(`\n— ${label} (${width}×${height})`)
    await prepare(orca, browser, { width, height })
    const dir = join(OUT, label)
    const result = await runSteps(browser, compactSteps(browser), dir)
    writeReport(dir, `Agent Flow — compact layout, ${label} ${width}×${height} (test data)`, result)
    failed += result.failed
  }
} finally {
  // Close only the tab this run opened, by its page id (`--index` is not the position in `tab list`).
  if (orca(['tab', 'list']).tabs.some((t: { browserPageId: string }) => t.browserPageId === page)) orca(['tab', 'close', '--page', page])
  await server.stop()
}
process.exit(failed ? 1 : 0)
