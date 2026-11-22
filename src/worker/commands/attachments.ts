// Images the person attaches in Agent Flow's message box. They arrive in base64 chunks (Orca caps
// each panel request), are checked to really be the image type they claim, and are saved where
// Orca's own chat keeps attachments (`agent-session-attachments/<uuid>/<file>`), so Orca turns an
// `@"<path>"` mention into a real attachment. Only files this store saved can be sent.
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { homedir, platform } from 'node:os'
import { join } from 'node:path'

export const ATTACHMENT_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] as const
export type AttachmentType = (typeof ATTACHMENT_TYPES)[number]
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024
export const MAX_ATTACHMENTS_PER_MESSAGE = 5
const UPLOAD_TTL_MS = 5 * 60 * 1000
const MAX_PENDING_UPLOADS = 10
const EXTENSION: Record<AttachmentType, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' }

/** Orca's own attachments folder when Orca's data folder exists, else Agent Flow's state folder. */
export function attachmentsRoot(fallback: string): string {
  const home = homedir()
  const orcaDir =
    platform() === 'darwin'
      ? join(home, 'Library/Application Support/orca')
      : platform() === 'win32'
        ? join(process.env.APPDATA ?? join(home, 'AppData/Roaming'), 'orca')
        : join(process.env.XDG_CONFIG_HOME ?? join(home, '.config'), 'orca')
  return existsSync(orcaDir) ? join(orcaDir, 'agent-session-attachments') : join(fallback, 'agent-session-attachments')
}

/** True when the bytes start like the claimed image type (a renamed file is refused). */
export function looksLike(type: AttachmentType, bytes: Buffer): boolean {
  switch (type) {
    case 'image/png':
      return bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    case 'image/jpeg':
      return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
    case 'image/gif':
      return bytes.subarray(0, 4).toString('latin1') === 'GIF8'
    case 'image/webp':
      return bytes.subarray(0, 4).toString('latin1') === 'RIFF' && bytes.subarray(8, 12).toString('latin1') === 'WEBP'
  }
}

type Upload = { type: AttachmentType; chunks: string[]; length: number; startedAt: number }

export class AttachmentStore {
  private uploads = new Map<string, Upload>()
  /** attachment id → saved file. */
  private saved = new Map<string, string>()

  constructor(
    private readonly root: string,
    private readonly now: () => number = Date.now
  ) {}

  /**
   * One chunk of an upload. `offset` must equal what was received so far (chunks in order, retries
   * of the same chunk are harmless). The last chunk (`done`) checks and saves the file.
   */
  async append(uploadId: string, type: AttachmentType, chunk: string, offset: number, done: boolean): Promise<{ received: number } | { attachmentId: string; bytes: number }> {
    this.sweep()
    let upload = this.uploads.get(uploadId)
    if (!upload) {
      if (offset !== 0) throw codeError('invalid_params', 'This upload expired; attach the image again.')
      if (this.uploads.size >= MAX_PENDING_UPLOADS) throw codeError('busy', 'Too many images uploading at once.')
      upload = { type, chunks: [], length: 0, startedAt: this.now() }
      this.uploads.set(uploadId, upload)
    }
    if (upload.type !== type) throw codeError('invalid_params', 'The image type changed during the upload.')
    if (offset === upload.length) {
      upload.chunks.push(chunk)
      upload.length += chunk.length
    } else if (offset + chunk.length !== upload.length) {
      throw codeError('invalid_params', 'Image chunks arrived out of order; attach the image again.')
    }
    if (upload.length * 0.75 > MAX_ATTACHMENT_BYTES + 3) {
      this.uploads.delete(uploadId)
      throw codeError('too_large', `Images can be at most ${MAX_ATTACHMENT_BYTES / 1024 / 1024} MB.`)
    }
    if (!done) return { received: upload.length }
    this.uploads.delete(uploadId)
    const bytes = Buffer.from(upload.chunks.join(''), 'base64')
    if (!bytes.length || bytes.length > MAX_ATTACHMENT_BYTES) throw codeError('too_large', `Images can be at most ${MAX_ATTACHMENT_BYTES / 1024 / 1024} MB.`)
    if (!looksLike(type, bytes)) throw codeError('invalid_params', 'That file is not the image type it claims to be.')
    const attachmentId = randomUUID()
    const dir = join(this.root, attachmentId)
    await mkdir(dir, { recursive: true, mode: 0o700 })
    const path = join(dir, `agent-flow-paste-${this.now()}.${EXTENSION[type]}`)
    await writeFile(path, bytes, { mode: 0o600 })
    this.saved.set(attachmentId, path)
    if (this.saved.size > 200) this.saved.delete(this.saved.keys().next().value!)
    return { attachmentId, bytes: bytes.length }
  }

  /** The saved file for an attachment id, or null when this store did not save it. */
  pathFor(attachmentId: string): string | null {
    return this.saved.get(attachmentId) ?? null
  }

  private sweep(): void {
    const now = this.now()
    for (const [id, upload] of this.uploads) if (now - upload.startedAt > UPLOAD_TTL_MS) this.uploads.delete(id)
  }
}

/** How an attachment is mentioned in the message text, per delivery route. */
export function mentionFor(path: string, route: 'chat' | 'claude-terminal' | 'other'): string {
  // Orca's chat and Claude Code both read `@"<path>"` as an attached file; others get the plain path.
  return route === 'other' ? path : `@"${path.replace(/"/g, '\\"')}"`
}

function codeError(code: string, message: string): Error & { code: string } {
  return Object.assign(new Error(message), { code })
}
