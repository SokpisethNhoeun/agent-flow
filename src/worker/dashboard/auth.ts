// Dashboard access token: random, stored in Orca's encrypted plugin secrets when the OS keyring
// is available, otherwise in a 0600 file in the plugin's own state folder.
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { OrcaWorkerApi } from 'orca/worker'

type SecretsApi = OrcaWorkerApi['secrets']

const SECRET_KEY = 'dashboardToken'

export async function loadOrCreateToken(secrets: SecretsApi | undefined, protection: string, dir: string): Promise<string> {
  const existing = useKeyring(secrets, protection) ? await secrets!.get(SECRET_KEY).catch(() => null) : await readTokenFile(dir)
  if (existing && existing.length >= 32) return existing
  return storeToken(secrets, protection, dir, newToken())
}

/** Always replaces the stored token with a fresh one (e.g. when dashboard controls are turned on). */
export async function rotateToken(secrets: SecretsApi | undefined, protection: string, dir: string): Promise<string> {
  return storeToken(secrets, protection, dir, newToken())
}

function useKeyring(secrets: SecretsApi | undefined, protection: string): boolean {
  return Boolean(secrets) && protection === 'os-keyring'
}

function tokenFile(dir: string): string {
  return join(dir, 'dashboard-token')
}

async function readTokenFile(dir: string): Promise<string | null> {
  try {
    return (await readFile(tokenFile(dir), 'utf8')).trim()
  } catch {
    return null
  }
}

async function storeToken(secrets: SecretsApi | undefined, protection: string, dir: string, token: string): Promise<string> {
  if (useKeyring(secrets, protection)) {
    await secrets!.set(SECRET_KEY, token)
    return token
  }
  await mkdir(dir, { recursive: true, mode: 0o700 })
  await writeFile(tokenFile(dir), token, { mode: 0o600 })
  // writeFile's mode only applies on create; make sure an existing file is 0600 too.
  await chmod(tokenFile(dir), 0o600)
  return token
}

export function newToken(): string {
  return randomBytes(32).toString('hex')
}

export function tokensMatch(expected: string, given: string | null | undefined): boolean {
  if (!given) return false
  const a = Buffer.from(expected)
  const b = Buffer.from(given)
  return a.length === b.length && timingSafeEqual(a, b)
}

/** DNS-rebinding guard: only loopback host names with our port. */
export function hostAllowed(hostHeader: string | undefined, port: number): boolean {
  if (!hostHeader) return false
  return hostHeader === `127.0.0.1:${port}` || hostHeader === `localhost:${port}` || hostHeader === `[::1]:${port}`
}
