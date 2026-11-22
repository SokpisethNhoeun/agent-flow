import assert from 'node:assert/strict'
import { readFile, stat } from 'node:fs/promises'
import { test } from 'node:test'
import { AttachmentStore, looksLike, MAX_ATTACHMENT_BYTES, mentionFor } from '../src/worker/commands/attachments.ts'
import { tempDir } from './helpers/fixtures.ts'

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64')
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

test('saves a chunked image under agent-session-attachments/<uuid>/ and only its own files can be sent', async () => {
  const tmp = await tempDir()
  try {
    const store = new AttachmentStore(`${tmp.dir}/agent-session-attachments`)
    const b64 = PNG.toString('base64')
    const half = Math.floor(b64.length / 2)
    assert.deepEqual(await store.append(id(1), 'image/png', b64.slice(0, half), 0, false), { received: half })
    // A retried chunk is harmless
    assert.deepEqual(await store.append(id(1), 'image/png', b64.slice(0, half), 0, false), { received: half })
    const done = await store.append(id(1), 'image/png', b64.slice(half), half, true)
    assert.ok('attachmentId' in done)
    const path = store.pathFor(done.attachmentId)!
    assert.match(path, /agent-session-attachments\/[0-9a-f-]{36}\/agent-flow-paste-\d+\.png$/)
    assert.deepEqual(await readFile(path), PNG)
    assert.equal((await stat(path)).mode & 0o777, 0o600)
    assert.equal(store.pathFor(id(99)), null, 'unknown ids are not files')
  } finally {
    await tmp.cleanup()
  }
})

test('refuses a file that is not the image type it claims, and oversized uploads', async () => {
  const tmp = await tempDir()
  try {
    const store = new AttachmentStore(tmp.dir)
    await assert.rejects(store.append(id(2), 'image/png', Buffer.from('#!/bin/sh\necho hi').toString('base64'), 0, true), /not the image type/)
    const big = 'A'.repeat(Math.ceil((MAX_ATTACHMENT_BYTES * 4) / 3) + 8)
    await assert.rejects(store.append(id(3), 'image/png', big, 0, false), /at most 10 MB/)
    await assert.rejects(store.append(id(4), 'image/png', 'AAAA', 4, false), /expired/)
  } finally {
    await tmp.cleanup()
  }
})

test('magic bytes and mentions', () => {
  assert.equal(looksLike('image/png', PNG), true)
  assert.equal(looksLike('image/jpeg', Buffer.from([0xff, 0xd8, 0xff, 0xe0])), true)
  assert.equal(looksLike('image/webp', Buffer.from('RIFF\0\0\0\0WEBPVP8 ', 'latin1')), true)
  assert.equal(looksLike('image/gif', PNG), false)
  assert.equal(mentionFor('/a/b c.png', 'chat'), '@"/a/b c.png"')
  assert.equal(mentionFor('/a/b.png', 'other'), '/a/b.png')
})

test('an upload piece fits Orca panel messages (66 560 bytes) with its request around it', async () => {
  const { CHUNK } = await import('../src/ui/chat/use-image-attachments.ts')
  const request = JSON.stringify({ orca: 1, kind: 'req', id: 1, name: 'flow.command', input: { requestId: 'x'.repeat(40), kind: 'agent.attach', params: { uploadId: id(1), mediaType: 'image/webp', chunk: 'A'.repeat(CHUNK), offset: '123456789', done: false } } })
  assert.ok(Buffer.byteLength(request) < 66_560, `${Buffer.byteLength(request)} bytes`)
})
