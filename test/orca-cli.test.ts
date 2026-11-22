import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { chmod, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createCliRunner, looksLikeScreenReader, parseCliOutput } from '../src/worker/cli/orca-cli.ts'
import { tempDir } from './helpers/fixtures.ts'

describe('parseCliOutput', () => {
  it('returns the result of an ok envelope', () => {
    assert.deepEqual(parseCliOutput('{"ok":true,"result":{"runs":[]}}', null), { ok: true, result: { runs: [] } })
  })

  it('skips leading noise before the JSON', () => {
    assert.deepEqual(parseCliOutput('warning: something\n{"ok":true,"result":1}\n', null), { ok: true, result: 1 })
  })

  it('maps an error envelope even when the process failed', () => {
    const out = parseCliOutput('{"ok":false,"error":{"code":"not_permitted","message":"only the coordinator"}}', Object.assign(new Error('exit 1'), { code: 1 }))
    assert.deepEqual(out, { ok: false, code: 'not_permitted', message: 'only the coordinator' })
  })

  it('defaults missing error fields', () => {
    assert.deepEqual(parseCliOutput('{"ok":false}', null), { ok: false, code: 'action_failed', message: 'The orca CLI reported an error.' })
  })

  it('treats garbage as action_failed', () => {
    const out = parseCliOutput('Segmentation fault', null)
    assert.equal(out.ok, false)
    assert.equal(!out.ok && out.code, 'action_failed')
    const broken = parseCliOutput('{not json', new Error('boom'))
    assert.deepEqual(broken, { ok: false, code: 'action_failed', message: 'boom' })
  })

  it('treats JSON without ok as action_failed', () => {
    assert.equal(parseCliOutput('{"result":1}', null).ok, false)
  })

  it('reports a killed process as timeout', () => {
    assert.deepEqual(parseCliOutput('', Object.assign(new Error('killed'), { killed: true })), { ok: false, code: 'timeout', message: 'The orca CLI did not answer in time.' })
  })
})

describe('looksLikeScreenReader', () => {
  let dir = ''
  let cleanup: () => Promise<void> = async () => {}
  before(async () => ({ dir, cleanup } = await tempDir()))
  after(() => cleanup())

  it('detects the GNOME screen reader python script', async () => {
    const path = join(dir, 'orca-screen-reader')
    await writeFile(path, '#!/usr/bin/python3\n# Orca\n# Copyright 2005-2008 Sun Microsystems Inc.\n# Copyright The Orca Team\nimport orca\n')
    assert.equal(await looksLikeScreenReader(path), true)
  })

  it('detects a non-python file that mentions the Orca Team', async () => {
    const path = join(dir, 'orca-wrapper')
    await writeFile(path, '#!/bin/sh\n# The Orca Team\nexec python3 -m orca.orca_main "$@"\n')
    assert.equal(await looksLikeScreenReader(path), true)
  })

  it('accepts the Orca IDE bash shim', async () => {
    const path = join(dir, 'orca')
    await writeFile(path, '#!/usr/bin/env bash\nexec "/opt/Orca/orca-ide" --cli "$@"\n')
    assert.equal(await looksLikeScreenReader(path), false)
  })

  it('returns false for a missing file', async () => {
    assert.equal(await looksLikeScreenReader(join(dir, 'missing')), false)
  })
})

describe('createCliRunner', () => {
  it('reports cli_unavailable without a path', async () => {
    const result = await createCliRunner(null).run(['status'])
    assert.equal(result.ok, false)
    assert.equal(!result.ok && result.code, 'cli_unavailable')
  })

  it('runs an executable with --json and parses its output', async () => {
    const { dir, cleanup } = await tempDir()
    try {
      const path = join(dir, 'fake-orca')
      await writeFile(path, '#!/bin/sh\nprintf \'{"ok":true,"result":{"args":"%s"}}\' "$*"\n')
      await chmod(path, 0o755)
      const result = await createCliRunner(path).run<{ args: string }>(['orchestration', 'run-list'])
      assert.deepEqual(result, { ok: true, result: { args: 'orchestration run-list --json' } })
    } finally {
      await cleanup()
    }
  })
})
