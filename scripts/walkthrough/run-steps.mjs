// Runs walkthrough steps: act, wait for the expected change, screenshot, record; then the report.
import { copyFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { sleep } from './browser.mjs'

/**
 * A step: { name, act, expect?: page expression, check?: () => boolean (node side), optional?, settle? }.
 * `optional` is a page expression; when false the step is skipped (nothing to act on).
 */
export async function runSteps(browser, steps, outDir) {
  rmSync(outDir, { recursive: true, force: true })
  mkdirSync(outDir, { recursive: true })
  const results = []
  for (const [index, step] of steps.entries()) {
    const n = String(index + 1).padStart(2, '0')
    let status = 'pass'
    let note = ''
    try {
      if (step.optional && browser.evaluate(`Boolean(${step.optional})`) !== true) {
        status = 'skip'
        note = 'Nothing to act on right now'
      } else {
        await step.act()
        const deadline = Date.now() + Math.max(3000, step.settle ?? 0)
        const met = async () => (!step.expect || browser.evaluate(`Boolean(${step.expect})`) === true) && (!step.check || (await step.check()) === true)
        let ok
        while (!(ok = await met()) && Date.now() < deadline) await sleep(250)
        await sleep(400) // let animations finish before the screenshot
        if (!ok) {
          status = 'fail'
          note = `Expected: ${[step.expect, step.check && step.check.toString()].filter(Boolean).join(' and ')}`
        }
      }
    } catch (error) {
      status = 'fail'
      note = error.message
    }
    const file = `${n}-${step.name.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase()}.png`
    try {
      copyFileSync(browser.screenshot(), join(outDir, file))
    } catch (error) {
      note += ` (screenshot failed: ${error.message})`
    }
    // Main-thread freezes during this step (long tasks over 50 ms), when the page reports them.
    try {
      const long = browser.evaluate('(() => { const l = window.__afLong || []; window.__afLong = []; return l })()')
      if (long.length) note += `${note ? ' · ' : ''}long tasks: ${long.join(', ')} ms`
    } catch {
      // the page may be gone
    }
    results.push({ n, name: step.name, status, note, file })
    console.log(`${status.toUpperCase().padEnd(4)} ${n} ${step.name}${note ? ` — ${note}` : ''}`)
  }
  const pageErrors = browser.evaluate(`window.__afErrors || []`)
  console.log(pageErrors.length ? `FAIL page errors: ${pageErrors.join('; ')}` : 'PASS no page errors')
  return { results, pageErrors, failed: results.filter((r) => r.status === 'fail').length + (pageErrors.length ? 1 : 0) }
}

export function writeReport(outDir, title, { results, pageErrors }) {
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
  writeFileSync(
    join(outDir, 'report.html'),
    `<!doctype html><meta charset="utf-8"><title>${esc(title)}</title>
<style>body{font:14px system-ui;margin:24px;background:#0b0b0d;color:#ececf1}h1{font-size:20px}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(420px,1fr));gap:16px}
.card{background:#151518;border:1px solid #2a2a30;border-radius:10px;overflow:hidden}.card header{display:flex;gap:8px;align-items:center;padding:10px 12px}
.badge{font-size:11px;font-weight:700;padding:2px 8px;border-radius:999px}.pass{background:#14532d;color:#86efac}.fail{background:#7f1d1d;color:#fca5a5}.skip{background:#3f3f46;color:#d4d4d8}
img{width:100%;display:block;border-top:1px solid #2a2a30;cursor:zoom-in}.note{padding:0 12px 10px;color:#a1a1aa;font-size:12px}</style>
<h1>${esc(title)}</h1>
<p>${results.filter((r) => r.status === 'pass').length} passed · ${results.filter((r) => r.status === 'fail').length} failed · ${results.filter((r) => r.status === 'skip').length} skipped · page errors: ${pageErrors.length ? esc(pageErrors.join('; ')) : 'none'}</p>
<div class="grid">${results
      .map((r) => `<div class="card"><header><span class="badge ${r.status}">${r.status.toUpperCase()}</span><strong>${r.n}. ${esc(r.name)}</strong></header>${r.note ? `<div class="note">${esc(r.note)}</div>` : ''}<a href="${r.file}" target="_blank"><img src="${r.file}" alt="${esc(r.name)}"></a></div>`)
      .join('')}</div>`
  )
  console.log(`\nReport: ${join(outDir, 'report.html')}`)
}
