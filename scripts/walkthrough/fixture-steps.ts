// Steps for the controls walkthrough against test data (see fixture-server.ts). Unlike the live
// walkthrough these press Confirm, Retry, Stop and Send: the stand-in server only records them.
import { sleep } from './browser.mjs'
import type { Recorded } from './fixture-server.ts'
import { FIXTURE_PNG } from './fixture-data.ts'

type Browser = ReturnType<typeof import('./browser.mjs').createBrowser>
type Server = { commands: Recorded[]; refresh: () => Promise<void>; streamReply: (text: string) => void; setLive: (live: boolean) => Promise<void>; grow: (n: number) => Promise<void>; setAgentState: (id: string, state: string) => Promise<void>; starOn: () => Promise<void>; updateOn: () => Promise<void> }

export function fixtureSteps(b: Browser, server: Server) {
  const sent = async (kind: string, test: (c: Recorded) => boolean = () => true) => {
    await server.refresh()
    return server.commands.filter((c) => c.kind === kind && test(c))
  }
  return [
    { name: 'Dashboard loaded with test data', act: () => {}, expect: `T.all('.react-flow__node').length > 0 && T.text().includes('[Test fixture]')` },
    // Regression: a selected card vanishing and coming back (agents going idle under “Active”) used
    // to make the selection flip forever and crash the page.
    { name: 'Right-click the lead card', act: () => b.rightClick('.react-flow__node:not(.react-flow__node-project)'), expect: `T.open('menu')` },
    { name: 'All agents go idle (canvas empties)', act: () => server.setLive(false), expect: `T.all('.react-flow__node').length === 0` },
    { name: 'They start working again (no crash)', act: () => server.setLive(true), expect: `T.all('.react-flow__node').length > 0 && !!T.btn('Workflow') && (window.__afErrors || []).length === 0`, settle: 2000 },
    { name: 'Esc clears the selection', act: () => b.key('Escape'), expect: `T.all('.react-flow__node.selected').length === 0 && T.text().includes('Nothing selected')` },
    // Left sidebar: collapse to an icon rail from its own header; a rail icon reopens on that section.
    { name: 'Collapse the sidebar («)', act: () => b.click('button', 'Collapse sidebar'), expect: `!!T.css('.af-rail') && !T.css('.af-side.left:not(.rail)') && T.css('.af-side.left.rail').getBoundingClientRect().width <= 48` },
    { name: 'Hover a rail icon (tooltip)', act: async () => { b.hover('button', /^Tasks, /); await sleep(700) }, expect: `T.open('tooltip') && /Tasks: \\d+/.test(T.text())` },
    { name: 'Click “Tasks” in the rail', act: () => b.click('button', /^Tasks, /), expect: `!T.css('.af-rail') && !!document.getElementById('af-section-tasks')` },
    { name: 'Fold the “Projects” section', act: () => b.click('button', 'Collapse Projects'), expect: `!!T.btn('Expand Projects')` },
    { name: 'Reload: fold is remembered', act: () => b.reload(), expect: `!!T.btn('Expand Projects') && !!T.css('.react-flow__node')`, settle: 6000 },
    { name: 'Unfold “Projects” again', act: () => b.click('button', 'Expand Projects'), expect: `!!T.btn('Collapse Projects')` },
    // Keyboard: arrow keys move between cards by position; focus follows (with a visible ring).
    { name: 'Press → (first card)', act: () => { b.evaluate('(document.activeElement.blur(), true)'); b.key('ArrowRight') }, expect: `(document.activeElement.getAttribute('aria-label') || '').startsWith('Lead ')` },
    { name: 'Press → (next card to the right)', act: () => b.key('ArrowRight'), expect: `(document.activeElement.getAttribute('aria-label') || '').startsWith('Team ')` },
    { name: 'Press → again (a worker)', act: () => b.key('ArrowRight'), expect: `(document.activeElement.getAttribute('aria-label') || '').startsWith('Agent Worker')` },
    { name: 'Press ↓ (the worker below)', act: () => { b.evaluate(`(window.__was = (document.activeElement.getAttribute('aria-label') || ''), true)`); b.key('ArrowDown') }, expect: `(document.activeElement.getAttribute('aria-label') || '').startsWith('Agent Worker') && (document.activeElement.getAttribute('aria-label') || '') !== window.__was && (document.querySelector('.af-side.right .af-panel-head') || {}).innerText.startsWith('Worker') && document.querySelector('.af-canvas').dataset.kbd === '1'` },
    { name: 'Press ← (back toward the lead)', act: () => b.key('ArrowLeft'), expect: `(document.activeElement.getAttribute('aria-label') || '').startsWith('Team ')` },
    { name: 'Esc clears it', act: () => b.key('Escape'), expect: `T.text().includes('Nothing selected')` },
    { name: 'Open “needs you”', act: () => b.click('button', /needs? you$/), expect: `T.open('menu') && T.all('[role=menuitem]').length >= 2` },
    { name: 'Pick the blocked worker', act: () => b.click('menuitem', /Worker: docs/), expect: `!T.open('menu') && (document.querySelector('.af-side.right .af-panel-head') || {}).innerText === 'Worker: docs'` },
    { name: 'Inspector: Log tab', act: () => b.click('tab', /^Log/), expect: `T.tab('Log').getAttribute('data-state') === 'active'` },
    { name: 'Inspector: Git tab', act: () => b.click('tab', /^Git/), expect: `T.tab('Git').getAttribute('data-state') === 'active'`, settle: 1500 },
    { name: 'Inspector: Actions tab', act: () => b.click('tab', /^Actions/), expect: `T.tab('Actions').getAttribute('data-state') === 'active' && T.text().includes('Stop worker')` },
    { name: 'Inspector: Info tab', act: () => b.click('tab', /^Info/), expect: `T.tab('Info').getAttribute('data-state') === 'active'` },
    { name: 'Close the inspector', act: () => b.click('button', 'Close inspector'), expect: `T.text().includes('Nothing selected')` },
    { name: 'Open the run dropdown', act: () => b.click('combobox', 'Orchestration run'), expect: `T.open('listbox') && T.text().includes('done')` },
    { name: 'Pick the test run (totals appear)', act: () => b.click('option', /Build the login page/), expect: `!T.open('listbox') && !!T.css('.af-run-summary') && T.css('.af-run-summary').innerText.includes('1/4')` },
    { name: 'Hover the run totals (details)', act: async () => { b.hover('generic', /^Run progress/); await sleep(700) }, expect: `T.open('tooltip') && T.text().includes('tasks done') && T.text().includes('Tokens')` },
    { name: 'Show all agents', act: () => b.click('radio', 'All'), expect: `T.btn('All').getAttribute('data-state') === 'on'` },
    { name: 'Ctrl+A selects every card (batch bar)', act: () => b.key('Control+a'), expect: `!!T.css('.af-selection-bar') && /\\d+ selected/.test(T.css('.af-selection-bar').innerText)` },
    { name: 'Click “Retry tasks”', act: () => b.click('button', /^Retry tasks \(\d+\)$/), expect: `T.open('dialog') && /Retry \\d+ tasks?\\?/.test(T.text())` },
    { name: 'Confirm the retry', act: () => b.click('button', /^Retry \d+$/), expect: `!T.open('dialog')`, check: async () => (await sent('task.retry', (c) => c.confirmed)).length >= 2 },
    { name: 'Click “Stop workers”', act: () => b.click('button', /^Stop workers \(\d+\)$/), expect: `T.open('dialog') && T.text().includes('Stop 2 workers?')` },
    { name: 'Confirm the stop', act: () => b.click('button', 'Stop 2'), expect: `!T.open('dialog')`, check: async () => (await sent('agent.stop', (c) => c.confirmed && ['w_live', 'w_block'].includes(String(c.params.agentId)))).length === 2 },
    { name: 'Esc clears the selection', act: () => b.key('Escape'), expect: `!T.css('.af-selection-bar')` },
    { name: 'Click the live worker’s card', act: () => b.clickCard('Worker: API'), expect: `!!T.tab('Chat')` },
    { name: 'Open its Chat tab', act: () => b.click('tab', /^Chat/), expect: `T.text().includes('Adding POST /session next')`, settle: 3000 },
    { name: 'Images in the chat show (tool result)', act: () => {}, expect: `T.all('.af-chat-row.assistant .af-chat-image img').some((img) => img.complete && img.naturalWidth > 0)`, settle: 3000 },
    { name: 'Images you attached show', act: () => {}, expect: `T.all('.af-chat-row.user .af-chat-image img').some((img) => img.complete && img.naturalWidth > 0)`, settle: 3000 },
    { name: 'A new reply streams in (pushed, no polling)', act: () => server.streamReply('[Test fixture] Session API done, tests pass.'), expect: `T.text().includes('Session API done, tests pass')`, settle: 2500 },
    { name: 'Open “Find in output”', act: () => b.click('button', 'Find in output'), expect: `!!T.label('Find in output') && T.label('Find in output').tagName === 'INPUT'` },
    { name: 'Type “login” (matches highlighted)', act: () => b.type('login'), expect: `/\\d+ match/.test(T.text()) && /of \\d+ messages/.test(T.text())` },
    { name: 'Esc closes find', act: () => b.key('Escape'), expect: `!T.text().match(/\\d+ match/)` },
    {
      name: 'Type a message and press Send',
      act: async () => {
        b.click('textbox', /message|prompt|Send/i)
        b.type('[Test fixture] please add rate limiting')
        await sleep(200)
        b.click('button', /^Send/)
      },
      check: async () => (await sent('agent.prompt', (c) => String(c.params.text).includes('rate limiting'))).length === 1,
      settle: 3000
    },
    // Images in the message box. Orca's browser CLI cannot paste files, so the page gets a real paste
    // event carrying a PNG file (the same event a Ctrl+V with an image produces).
    {
      name: 'Paste an image into the message box',
      act: () =>
        b.evaluate(`(() => { const bin = atob(${JSON.stringify(FIXTURE_PNG)}); const bytes = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i); const file = new File([bytes], 'screenshot.png', { type: 'image/png' }); const dt = new DataTransfer(); dt.items.add(file); document.querySelector('.af-chat-input').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); return true })()`),
      expect: `!!T.css('.af-chat-attachment.ready img') && T.css('.af-chat-attachment img').naturalWidth > 0`,
      settle: 3000
    },
    {
      name: 'Paste a big screenshot-sized image (2.4 MB)',
      act: () =>
        b.evaluate(`(() => { const c = document.createElement('canvas'); c.width = 900; c.height = 900; const g = c.getContext('2d'); const img = g.createImageData(900, 900); for (let i = 0; i < img.data.length; i++) img.data[i] = (i % 4 === 3) ? 255 : (Math.random() * 256) | 0; g.putImageData(img, 0, 0); c.toBlob((blob) => { const dt = new DataTransfer(); dt.items.add(new File([blob], 'big.png', { type: 'image/png' })); document.querySelector('.af-chat-input').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })) }, 'image/png'); return true })()`),
      expect: `T.all('.af-chat-attachment.ready').length === 2 && !T.css('.af-chat-attachment.error')`,
      settle: 20000
    },
    { name: 'Type a caption and send with the image', act: async () => { b.click('textbox', /^Message /); b.type('[Test fixture] what is wrong here?'); await sleep(200); b.click('button', 'Send message') }, expect: `!T.css('.af-chat-attachment')`, check: async () => (await sent('agent.attach', (c) => c.params.done === true)).length >= 1 && (await sent('agent.prompt', (c) => Array.isArray(c.params.attachments) && c.params.attachments.length === 2 && String(c.params.text).includes('what is wrong'))).length === 1, settle: 3000 },
    { name: 'Open the timeline panel', act: () => b.click('button', 'Toggle timeline'), expect: `!!T.tab('History')`, optional: `!T.tab('History')` },
    { name: 'Open the History tab', act: () => b.click('tab', /^History/), expect: `T.text().includes('Pick two runs')`, settle: 3000 },
    { name: 'Pick run A', act: () => b.click('checkbox', /yesterday/), expect: `T.text().includes('Pick one more run')` },
    { name: 'Pick run B', act: () => b.click('checkbox', /Compare: \[Test fixture\] Build the login page$/), expect: `T.text().includes('2 runs picked')` },
    { name: 'Click “Compare”', act: () => b.click('button', 'Compare'), expect: `T.open('dialog') && T.text().includes('Now failing') && T.text().includes('Fixed')`, settle: 3000 },
    { name: 'Close the comparison', act: () => b.key('Escape'), expect: `!T.open('dialog')` },
    // Screen readers: a worker becoming blocked is announced at once (assertive), a finish politely.
    { name: 'A worker gets blocked (announced)', act: () => server.setAgentState('w_live', 'blocked'), expect: `(document.querySelector('.af-sr-only[role=alert]') || {}).textContent === 'Worker: API is blocked and needs you.'`, settle: 4000 },
    { name: 'It finishes (announced politely)', act: () => server.setAgentState('w_live', 'done'), expect: `(document.querySelector('.af-sr-only[role=status]') || {}).textContent === 'Worker: API finished.'`, settle: 4000 },
    // Layout off the main thread: a box jumps from 7 to 87 cards, then to 92. Long tasks are logged in the note.
    { name: 'Show the flat canvas', act: () => b.click('radio', 'Flat'), expect: `T.all('.react-flow__node-project').length === 0` },
    { name: 'Back to project boxes', act: () => b.click('radio', 'Boxes'), expect: `T.all('.react-flow__node-project').length > 0` },
    { name: 'The worker spawns 80 sub-agents at once', act: async () => { b.evaluate('(window.__afLong = [], true)'); await server.grow(80) }, expect: `T.text().includes('Sub-agent') && (window.__afErrors || []).length === 0`, settle: 4000 },
    { name: 'Exact layout arrives (no overlapping cards)', act: () => sleep(1500), expect: `(() => { const r = T.all('.react-flow__node:not(.react-flow__node-project)').map((n) => n.getBoundingClientRect()).filter((x) => x.width > 0); return r.every((a, i) => r.every((c, j) => j <= i || a.right <= c.left + 1 || c.right <= a.left + 1 || a.bottom <= c.top + 1 || c.bottom <= a.top + 1)) })()`, settle: 3000 },
    { name: 'Five more join (box re-laid in the worker)', act: () => server.grow(5), expect: `(window.__afErrors || []).length === 0`, settle: 2000 },
    // New-version notice (the stand-in pretends 0.1.6 is out; Update needs approval in this case).
    { name: 'A newer version is announced', act: async () => { await server.updateOn(); await b.reload() }, expect: `!!T.css('.af-update') && T.text().includes('Agent Flow 0.1.6 is available')`, settle: 6000 },
    { name: 'Click “Update” (approval needed)', act: () => b.click('button', 'Update'), expect: `T.open('dialog') && (document.getElementById('af-update-cmd') || {}).value.includes('--approve') && T.text().includes('orca-ide')`, check: async () => (await sent('update.run')).length === 1 },
    { name: 'Close the approval dialog', act: () => b.key('Escape'), expect: `!T.open('dialog')` },
    { name: 'Click “Later” on the notice', act: () => b.click('button', 'Later'), expect: `!T.css('.af-update')` },
    // The occasional "star on GitHub" prompt (the worker decides when; the stand-in forces it here).
    { name: 'Star prompt appears (after real use)', act: async () => { await server.starOn(); await b.reload() }, expect: `!!T.css('.af-star') && T.text().includes('Enjoying Agent Flow?')`, settle: 6000 },
    { name: 'Click “Later” (asks again in 30 days)', act: () => b.click('button', 'Later'), expect: `!T.css('.af-star')`, check: async () => (await sent('star.answer', (c) => c.params.answer === 'later')).length === 1 },
    // Library scrollbars (Radix Scroll Area): the long sidebar shows a thin themed scrollbar on hover.
    { name: 'Hover the long sidebar (scrollbar)', act: async () => { b.hover('button', 'Collapse Subagents'); await sleep(500) }, expect: `!!document.querySelector('.af-side.left .af-ui-scrollbar[data-state=visible] .af-ui-scroll-thumb')` }
  ]
}

/** The same features at narrow sizes (Orca's side panel, a small window, a phone): compact layout. */
export function compactSteps(b: Browser) {
  return [
    { name: 'Loads in the compact layout', act: () => {}, expect: `T.all('.react-flow__node').length > 0 && !!document.querySelector('.af-compact')` },
    { name: 'Toolbar fits (no page scroll)', act: () => {}, expect: `document.documentElement.scrollWidth <= innerWidth + 1` },
    { name: 'Open “needs you”', act: () => b.click('button', /needs? you$/), expect: `T.open('menu')` },
    { name: 'Pick the blocked worker (inspector overlay)', act: () => b.click('menuitem', /Worker: docs/), expect: `!T.open('menu') && !!T.tab('Chat')` },
    { name: 'Open the Chat tab', act: () => b.click('tab', /^Chat/), expect: `T.tab('Chat').getAttribute('data-state') === 'active'`, settle: 2000 },
    { name: 'Inspector fits the width', act: () => {}, expect: `document.querySelector('.af-side.right').getBoundingClientRect().right <= innerWidth + 1 && document.documentElement.scrollWidth <= innerWidth + 1` },
    { name: 'Close the inspector', act: () => b.click('button', 'Close inspector'), expect: `!T.tab('Chat')` },
    { name: 'Open the run dropdown', act: () => b.click('combobox', 'Orchestration run'), expect: `T.open('listbox')` },
    { name: 'Pick the test run', act: () => b.click('option', /Build the login page/), expect: `!T.open('listbox')` },
    { name: 'Ctrl+A shows the batch bar', act: () => b.key('Control+a'), expect: `!!T.css('.af-selection-bar') && T.css('.af-selection-bar').getBoundingClientRect().right <= innerWidth + 1 && T.css('.af-selection-bar').scrollWidth <= T.css('.af-selection-bar').clientWidth + 1` },
    { name: 'Esc clears it', act: () => b.key('Escape'), expect: `!T.css('.af-selection-bar')` }
  ]
}
