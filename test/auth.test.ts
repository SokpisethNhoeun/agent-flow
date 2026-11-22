import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { hostAllowed, loadOrCreateToken, newToken, rotateToken, tokensMatch } from '../src/worker/dashboard/auth.ts'
import { tempDir } from './helpers/fixtures.ts'

describe('tokensMatch', () => {
  const token = newToken()
  it('matches the exact token only', () => {
    assert.equal(tokensMatch(token, token), true)
    assert.equal(tokensMatch(token, token.slice(0, -1) + (token.endsWith('a') ? 'b' : 'a')), false)
    assert.equal(tokensMatch(token, token + 'x'), false)
    assert.equal(tokensMatch(token, token.slice(1)), false)
  })
  it('refuses missing tokens', () => {
    assert.equal(tokensMatch(token, ''), false)
    assert.equal(tokensMatch(token, null), false)
    assert.equal(tokensMatch(token, undefined), false)
  })
  it('newToken is 64 hex chars and random', () => {
    assert.match(token, /^[0-9a-f]{64}$/)
    assert.notEqual(newToken(), token)
  })
})

describe('hostAllowed', () => {
  it('allows loopback names with the right port', () => {
    assert.equal(hostAllowed('127.0.0.1:47900', 47900), true)
    assert.equal(hostAllowed('localhost:47900', 47900), true)
    assert.equal(hostAllowed('[::1]:47900', 47900), true)
  })
  it('refuses other hosts, ports or missing headers', () => {
    assert.equal(hostAllowed(undefined, 47900), false)
    assert.equal(hostAllowed('', 47900), false)
    assert.equal(hostAllowed('127.0.0.1:47901', 47900), false)
    assert.equal(hostAllowed('127.0.0.1', 47900), false)
    assert.equal(hostAllowed('evil.example:47900', 47900), false)
    assert.equal(hostAllowed('localhost.evil.example:47900', 47900), false)
    assert.equal(hostAllowed('0.0.0.0:47900', 47900), false)
  })
})

describe('loadOrCreateToken', () => {
  it('creates a 0600 file token once and reuses it', async () => {
    const { dir, cleanup } = await tempDir()
    try {
      const sub = join(dir, 'state')
      const first = await loadOrCreateToken(undefined, 'none', sub)
      assert.match(first, /^[0-9a-f]{64}$/)
      assert.equal(await loadOrCreateToken(undefined, 'none', sub), first)
      assert.equal((await readFile(join(sub, 'dashboard-token'), 'utf8')).trim(), first)
      assert.equal((await stat(join(sub, 'dashboard-token'))).mode & 0o777, 0o600)
    } finally {
      await cleanup()
    }
  })
})

describe('rotateToken', () => {
  it('always writes a fresh 0600 file token that loadOrCreateToken then returns', async () => {
    const { dir, cleanup } = await tempDir()
    try {
      const sub = join(dir, 'state')
      const original = await loadOrCreateToken(undefined, 'unavailable', sub)
      const rotated = await rotateToken(undefined, 'unavailable', sub)
      assert.match(rotated, /^[0-9a-f]{64}$/)
      assert.notEqual(rotated, original)
      assert.equal((await readFile(join(sub, 'dashboard-token'), 'utf8')).trim(), rotated)
      assert.equal((await stat(join(sub, 'dashboard-token'))).mode & 0o777, 0o600)
      assert.equal(await loadOrCreateToken(undefined, 'unavailable', sub), rotated)
      const again = await rotateToken(undefined, 'unavailable', sub)
      assert.notEqual(again, rotated)
    } finally {
      await cleanup()
    }
  })

  it('creates the folder when nothing was stored yet', async () => {
    const { dir, cleanup } = await tempDir()
    try {
      const sub = join(dir, 'fresh', 'state')
      const token = await rotateToken(undefined, 'unavailable', sub)
      assert.equal((await readFile(join(sub, 'dashboard-token'), 'utf8')).trim(), token)
    } finally {
      await cleanup()
    }
  })

  it('uses the encrypted secrets store when the OS keyring is available', async () => {
    const store = new Map<string, string>()
    const secrets = { get: async (k: string) => store.get(k) ?? null, set: async (k: string, v: string) => void store.set(k, v) }
    const { dir, cleanup } = await tempDir()
    try {
      const fake = secrets as unknown as Parameters<typeof rotateToken>[0]
      const first = await loadOrCreateToken(fake, 'os-keyring', dir)
      const rotated = await rotateToken(fake, 'os-keyring', dir)
      assert.notEqual(rotated, first)
      assert.equal(store.get('dashboardToken'), rotated)
      assert.equal(await loadOrCreateToken(fake, 'os-keyring', dir), rotated)
      await assert.rejects(readFile(join(dir, 'dashboard-token'), 'utf8'), 'no plaintext file in keyring mode')
    } finally {
      await cleanup()
    }
  })
})
