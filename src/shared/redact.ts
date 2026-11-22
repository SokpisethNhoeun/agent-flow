// Removes secrets from any text before it reaches a UI, the dashboard or history.

const REDACTED = '[redacted]'

/** Well-known token shapes, replaced wherever they appear. Order matters. */
const PATTERNS: [RegExp, string][] = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, '[redacted-private-key]'],
  // Bearer before the key=value rules: they would otherwise eat the word "Bearer".
  [/(Bearer\s+)[A-Za-z0-9._~+/-]{12,}=*/g, '$1[redacted]'],
  [/\b(sk-ant-[A-Za-z0-9_-]{10,})/g, '[redacted-key]'],
  [/\b(sk-[A-Za-z0-9_-]{20,})/g, '[redacted-key]'],
  [/\b(gh[pousr]_[A-Za-z0-9]{20,})/g, '[redacted-token]'],
  [/\b(github_pat_[A-Za-z0-9_]{20,})/g, '[redacted-token]'],
  [/\b(xox[abprs]-[A-Za-z0-9-]{10,})/g, '[redacted-token]'],
  [/\b(AKIA[0-9A-Z]{16})\b/g, '[redacted-aws-key]'],
  [/\b(AIza[0-9A-Za-z_-]{30,})/g, '[redacted-key]'],
  [/\b(eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})/g, '[redacted-jwt]'],
  // URL credentials: keep the user name, hide the password.
  [/\b([a-z][a-z0-9+.-]*:\/\/[^\s:/@?#]+:)[^\s@/?#]+@/gi, `$1${REDACTED}@`]
]

// ── Sensitive key names ─────────────────────────────────────────────────────

/** Any of these word segments makes a key sensitive (`client_secret`, `dbPassword`). */
const STRONG_SEGMENTS = new Set(['password', 'passwd', 'passphrase', 'secret', 'credential', 'credentials', 'authorization', 'apikey', 'privatekey'])
/** `key` as the last segment is sensitive only after one of these (`api_key`, `privateKey`) or in an UPPER_CASE env name. */
const KEY_PREFIXES = new Set(['api', 'access', 'private', 'secret', 'auth', 'signing', 'encryption', 'master', 'client', 'license', 'session'])

function segments(key: string): string[] {
  return key
    .split(/[_.-]+/)
    .flatMap((part) => part.replace(/([a-z0-9])([A-Z])/g, '$1 $2').split(' '))
    .filter(Boolean)
    .map((seg) => seg.toLowerCase())
}

/** True for names like `password`, `GITHUB_TOKEN`, `AWS_SECRET_ACCESS_KEY`, `api-key`, `accessToken`; false for `keyboard`, `token_count`, `max_tokens`. */
export function isSensitiveKey(key: string): boolean {
  const segs = segments(key)
  if (segs.length === 0) return false
  if (segs.some((seg) => STRONG_SEGMENTS.has(seg))) return true
  const upper = /[A-Z]/.test(key) && key === key.toUpperCase()
  const last = segs[segs.length - 1]
  if (last === 'token') return true
  if (last === 'key') return upper || (segs.length > 1 && KEY_PREFIXES.has(segs[segs.length - 2]))
  if (last === 'pass') return upper
  return false
}

function alreadyRedacted(value: string): boolean {
  return value.startsWith('[redacted')
}

// ── Key/value rules ─────────────────────────────────────────────────────────

const KEY = String.raw`[A-Za-z][A-Za-z0-9_.-]*`
const DQ = String.raw`"((?:\\.|[^"\\\n])*)"`
const SQ = String.raw`'((?:\\.|[^'\\\n])*)'`

type Handler = (groups: (string | undefined)[]) => string | null

/**
 * Like String.replace, but when the handler declines (returns null) the scan resumes one character
 * later instead of after the whole match, so a non-secret value can never swallow a following
 * `token=…` (`a=b,token=…`, `https://x/?token=…`).
 */
function replaceEach(text: string, pattern: RegExp, handler: Handler): string {
  const re = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : pattern.flags + 'g')
  let out = ''
  let copied = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    const replacement = handler(m.slice(1))
    if (replacement === null) {
      re.lastIndex = m.index + 1
      continue
    }
    out += text.slice(copied, m.index) + replacement
    copied = m.index + m[0].length
    re.lastIndex = copied
  }
  return out + text.slice(copied)
}

/** `"password": "…"` / `'api_key': '…'` (JSON, Python dicts). Quotes are kept so JSON stays valid. */
const QUOTED_KEY = new RegExp(String.raw`(["'])(${KEY})\1(\s*:\s*)(?:${DQ}|${SQ})`, 'g')

function redactQuotedKeys(text: string): string {
  return replaceEach(text, QUOTED_KEY, ([q, key, sep, dq, sq]) => {
    const value = dq ?? sq ?? ''
    if (!value || alreadyRedacted(value) || !isSensitiveKey(key!)) return null
    const vq = dq !== undefined ? '"' : "'"
    return `${q}${key}${q}${sep}${vq}${REDACTED}${vq}`
  })
}

/** `--password x`, `--api-key=x`, `--token "a b"`. */
const CLI_FLAG = new RegExp(String.raw`(?<![\w-])(--(${KEY}))(=|[ \t]+)(?:${DQ}|${SQ}|([^\s"'-][^\s"']*))`, 'g')

function redactCliFlags(text: string): string {
  return replaceEach(text, CLI_FLAG, ([flag, name, sep, dq, sq, bare]) => {
    const value = dq ?? sq ?? bare ?? ''
    if (!value || alreadyRedacted(value) || !isSensitiveKey(name!)) return null
    return `${flag}${sep}${REDACTED}`
  })
}

/** `password=…`, `secret: "a b c"`, `export OPENAI_API_KEY="…"`, `?token=…`. */
const ASSIGNMENT = new RegExp(String.raw`(?<![\w.-])(${KEY})(\s*[:=]\s*)(?:${DQ}|${SQ}|([^\s"'&]+))`, 'g')
const MIN_BARE_VALUE = 6

function redactAssignments(text: string): string {
  return replaceEach(text, ASSIGNMENT, ([key, sep, dq, sq, bare]) => {
    if (!isSensitiveKey(key!)) return null
    if (bare !== undefined) {
      // Short bare values are usually prose ("password: yes"); auth schemes keep their own rule.
      if (bare.length < MIN_BARE_VALUE || alreadyRedacted(bare) || /^(Bearer|Basic)$/i.test(bare)) return null
    } else {
      const value = dq ?? sq ?? ''
      if (!value || alreadyRedacted(value)) return null
    }
    return `${key}${sep}${REDACTED}`
  })
}

// ── Public API ──────────────────────────────────────────────────────────────

export function redact(text: string): string {
  let out = text
  for (const [pattern, replacement] of PATTERNS) out = out.replace(pattern, replacement)
  out = redactQuotedKeys(out)
  out = redactCliFlags(out)
  out = redactAssignments(out)
  return out
}

export function redactNullable(text: string | null | undefined): string | null {
  return text == null ? null : redact(text)
}

/** Redacts first, then truncates, so a cut can never leave a partial secret behind. */
export function redactAndTruncate(text: string, max: number): string {
  return truncate(redact(text), max)
}

/** Redacts lines as one text, so secrets that span lines (private key blocks) are caught. */
export function redactLines(lines: string[]): string[] {
  if (lines.length === 0) return []
  return redact(lines.join('\n')).split('\n')
}

/** Strips ANSI/OSC escape sequences from terminal output. */
export function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\u001b\][^\u0007\u001b]*(\u0007|\u001b\\)/g, '').replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, '').replace(/\u001b[@-Z\\-_78=>]/g, '')
}

export function truncate(text: string, max: number): string {
  return text.length <= max ? text : text.slice(0, max - 1) + '…'
}
