// Drives one tab of Orca's built-in browser like a person would: finds elements by role and name
// in Orca's accessibility snapshot, then clicks or types through Orca itself (no coordinates).
import { execFileSync } from 'node:child_process'

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

export function orcaCli() {
  const cli = process.env.ORCA_CLI_COMMAND
  if (!cli) {
    console.error('ORCA_CLI_COMMAND is not set (run this inside an Orca terminal).')
    process.exit(2)
  }
  return (argv, { json = true } = {}) => {
    const out = execFileSync(cli, [...argv, ...(json ? ['--json'] : [])], { encoding: 'utf8', timeout: 60_000, stdio: ['ignore', 'pipe', 'pipe'] })
    if (!json) return out
    const parsed = JSON.parse(out)
    if (!parsed.ok) throw new Error(`${argv[0]}: ${parsed.error?.message ?? 'failed'}`)
    return parsed.result
  }
}

// Helpers injected into the page before each check: they find elements the way a person would.
const HELPERS = `window.T = window.T || {
  vis: (el) => Boolean(el && el.getClientRects().length),
  all: (sel) => [...document.querySelectorAll(sel)].filter((el) => T.vis(el)),
  btn: (text) => T.all('button,[role=radio],[role=tab]').find((b) => b.innerText.trim() === text || b.getAttribute('aria-label') === text),
  label: (label) => T.all('[aria-label="' + label + '"]')[0],
  css: (sel) => T.all(sel)[0],
  option: (i) => T.all('[role=option]')[i],
  menuitem: (i) => T.all('[role=menuitem],[role=menuitemcheckbox]')[i],
  menuText: (text) => T.all('[role=menuitem]').find((m) => m.innerText.includes(text)),
  tab: (text) => T.all('[role=tab]').find((t) => t.innerText.trim().startsWith(text)),
  node: (text) => T.all('.react-flow__node').find((n) => n.innerText.includes(text) && !n.classList.contains('react-flow__node-project')),
  open: (role) => T.all('[role=' + role + ']').length > 0,
  text: () => document.body.innerText
};`

export function createBrowser(orca, page) {
  const P = ['--page', page]
  // Orca's eval returns every value as text ("false" included), so values travel as JSON.
  const evaluate = (expression) => {
    const text = orca(['eval', ...P, '--expression', `${HELPERS}\nJSON.stringify((() => { try { return { v: (${expression}) } } catch (e) { return { e: String(e) } } })())`]).result
    const parsed = JSON.parse(text)
    if (parsed.e) throw new Error(parsed.e)
    return parsed.v
  }
  const findRef = (role, name, nth = 0) => {
    const tree = orca(['snapshot', ...P]).snapshot
    const matches = []
    for (const line of tree.split('\n')) {
      const m = line.match(/^\s*- (\S+)(?: "((?:[^"\\]|\\.)*)")?.*\bref=(e\d+)/)
      if (!m || m[1] !== role) continue
      const label = m[2] ?? ''
      if (name instanceof RegExp ? name.test(label) : label === name) matches.push(m[3])
    }
    if (!matches[nth]) throw new Error(`Not found: ${role} ${name}${nth ? ` #${nth + 1}` : ''}`)
    return matches[nth]
  }
  /** A canvas card, by the name in its accessible label ("Agent Worker: API, Running"). */
  const findCard = (name) => {
    const lines = orca(['snapshot', ...P]).snapshot.split('\n')
    for (let i = 0; i < lines.length; i++) {
      // The card wrapper is a named group ("Agent Worker: API, Running") that can be clicked.
      const named = lines[i].match(/^\s*- group "([^"]*)" \[ref=(e\d+)\]/)
      if (named && named[1].includes(name)) return named[2]
    }
    throw new Error(`No card named ${name}`)
  }
  const api = {
    page,
    P,
    /** Reload, then restore the test window size (a reload resets it to the tab's own size). */
    reload: (size = { width: 1400, height: 860 }) => prepare(orca, api, size),
    clickCard: (name) => orca(['click', ...P, '--element', findCard(name)]),
    evaluate,
    findRef,
    click: (role, name, nth) => orca(['click', ...P, '--element', findRef(role, name, nth)]),
    hover: (role, name) => orca(['hover', ...P, '--element', findRef(role, name)]),
    key: (k) => orca(['keypress', ...P, '--key', k]),
    type: (text) => orca(['type', ...P, '--input', text]),
    fill: (role, name, value) => orca(['fill', ...P, '--element', findRef(role, name), '--value', value]),
    screenshot: () => orca(['screenshot', ...P, '--format', 'png']).path,
    /** Right-click: Orca has no right-click command, so the page gets a contextmenu event at the card. */
    rightClick: (css) => evaluate(`(() => { const pane = document.querySelector('.react-flow').getBoundingClientRect(); const inView = (el) => { const r = el.getBoundingClientRect(); return r.left >= pane.left && r.top >= pane.top && r.left + 60 < pane.right && r.top + 40 < pane.bottom }; const el = T.all(${JSON.stringify(css)}).find(inView); if (!el) throw new Error('No card in view'); const r = el.getBoundingClientRect(); el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.left + 40, clientY: r.top + 20, button: 2 })); return true })()`)
  }
  return api
}

/** Reloads the tab, sets the window size at the screen's own pixel ratio, waits for the canvas. */
export async function prepare(orca, browser, { width = 1400, height = 860, reload = true } = {}) {
  for (let i = 0; reload; i++) {
    try {
      orca(['reload', ...browser.P])
      break
    } catch (error) {
      // The dashboard restarts with every plugin reload (Orca reloads dev plugins on file changes).
      if (i > 15) throw error
      await sleep(2000)
    }
  }
  // A reload resets the emulated size, so set it afterwards. Keep the screen's own pixel ratio:
  // with a different one Orca's clicks land at scaled (wrong) positions.
  orca(['wait', ...browser.P, '--selector', '#root'])
  const nativeScale = Number(orca(['eval', ...browser.P, '--expression', 'String(devicePixelRatio)']).result) || 1
  orca(['viewport', ...browser.P, '--width', String(width), '--height', String(height), '--scale', String(nativeScale)])
  orca(['wait', ...browser.P, '--selector', '.react-flow__node'])
  await sleep(1500)
  // Main-thread freezes: every long task (over 50 ms) the browser reports, in milliseconds.
  browser.evaluate(`(window.__afLong = [], (() => { try { new PerformanceObserver((list) => list.getEntries().forEach((e) => window.__afLong.push(Math.round(e.duration)))).observe({ type: 'longtask', buffered: false }) } catch {} })(), true)`)
  // Uncaught errors, plus React's console errors (they carry the component stack in development builds).
  browser.evaluate(`(window.__afErrors = [], window.addEventListener('error', (e) => window.__afErrors.push(String(e.message))), (() => { const original = console.error; console.error = (...args) => { window.__afErrors.push(args.map(String).join(' ').slice(0, 1500)); original(...args) } })(), true)`)
}
