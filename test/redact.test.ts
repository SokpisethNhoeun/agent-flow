import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { isSensitiveKey, redact, redactAndTruncate, redactLines, redactNullable, stripAnsi, truncate } from '../src/shared/redact.ts'

describe('redact', () => {
  it('redacts Anthropic and OpenAI style keys', () => {
    assert.equal(redact('key sk-ant-api03-abcdefghijklmnop end'), 'key [redacted-key] end')
    assert.equal(redact('sk-abcdefghijklmnopqrstuvwx'), '[redacted-key]')
  })

  it('redacts GitHub tokens', () => {
    assert.equal(redact('ghp_' + 'a'.repeat(36)), '[redacted-token]')
    assert.equal(redact('gho_' + 'B'.repeat(24)), '[redacted-token]')
    assert.equal(redact('github_pat_' + '1'.repeat(30)), '[redacted-token]')
  })

  it('redacts Slack, AWS and Google keys', () => {
    assert.equal(redact('xoxb-1234567890-abc'), '[redacted-token]')
    assert.equal(redact('AKIAABCDEFGHIJKLMNOP'), '[redacted-aws-key]')
    assert.equal(redact('AIza' + 'x'.repeat(35)), '[redacted-key]')
  })

  it('redacts JWTs', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U'
    assert.equal(redact(`token ${jwt}`), 'token [redacted-jwt]')
  })

  it('redacts a bare bearer token', () => {
    assert.equal(redact('Bearer abcdefghijklmnop123'), 'Bearer [redacted]')
  })

  it('redacts the token in an "Authorization: Bearer <token>" header', () => {
    const out = redact('Authorization: Bearer abcdefghijklmnop123')
    assert.ok(!out.includes('abcdefghijklmnop123'), `token leaked: ${out}`)
  })

  it('redacts password=, secret: and api_key= assignments', () => {
    assert.equal(redact('password=hunter22'), 'password=[redacted]')
    assert.equal(redact('PASSWORD: "hunter22"'), 'PASSWORD: [redacted]')
    assert.equal(redact("secret='abcdef12'"), 'secret=[redacted]')
    assert.equal(redact('api_key=abcdef123'), 'api_key=[redacted]')
    assert.equal(redact('api-key: abcdef123'), 'api-key: [redacted]')
    assert.equal(redact('password=abc'), 'password=abc', 'short values are left alone')
  })

  it('redacts private key blocks', () => {
    const block = '-----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAKCAQEA\nabc\n-----END RSA PRIVATE KEY-----'
    assert.equal(redact(`before\n${block}\nafter`), 'before\n[redacted-private-key]\nafter')
    assert.equal(redact('-----BEGIN PRIVATE KEY-----\nx\n-----END PRIVATE KEY-----'), '[redacted-private-key]')
  })

  it('leaves ordinary text alone', () => {
    const text = 'Refactor the task-runner and run npm test; skip ghp_short.'
    assert.equal(redact(text), text)
  })

  it('redactNullable passes null through', () => {
    assert.equal(redactNullable(null), null)
    assert.equal(redactNullable(undefined), null)
    assert.equal(redactNullable('password=hunter22'), 'password=[redacted]')
  })
})

describe('stripAnsi', () => {
  it('strips SGR colour codes', () => assert.equal(stripAnsi('\u001b[31mred\u001b[0m \u001b[1;32mok\u001b[m'), 'red ok'))
  it('strips cursor and private-mode CSI', () => assert.equal(stripAnsi('\u001b[2K\u001b[1A\u001b[?25lhi\u001b[?25h'), 'hi'))
  it('strips OSC with BEL terminator', () => assert.equal(stripAnsi('\u001b]0;window title\u0007text'), 'text'))
  it('strips OSC with ST terminator (hyperlinks)', () => assert.equal(stripAnsi('\u001b]8;;https://x.dev\u001b\\link\u001b]8;;\u001b\\'), 'link'))
  it('strips two-byte Fe escapes', () => assert.equal(stripAnsi('a\u001bMb\u001bDc'), 'abc'))
  it('keeps plain text', () => assert.equal(stripAnsi('plain [brackets] text'), 'plain [brackets] text'))
})

describe('truncate', () => {
  it('keeps short text and cuts long text with an ellipsis', () => {
    assert.equal(truncate('abc', 3), 'abc')
    assert.equal(truncate('abcdef', 4), 'abc…')
    assert.equal(truncate('abcdef', 4).length, 4)
  })
})

describe('redact: JSON and quoted keys', () => {
  it('redacts JSON-quoted keys and keeps the JSON valid', () => {
    assert.equal(redact('{"password":"hunter2"}'), '{"password":"[redacted]"}')
    assert.equal(redact('{"api_key": "abc123", "name": "x"}'), '{"api_key": "[redacted]", "name": "x"}')
    assert.equal(redact('"token":"t0k"'), '"token":"[redacted]"')
    assert.equal(redact('"secret": "a b c"'), '"secret": "[redacted]"')
    assert.equal(redact(`{'client_secret': 'xyz'}`), `{'client_secret': '[redacted]'}`)
    assert.equal(redact('{"accessToken":"abc","refresh_token":"def"}'), '{"accessToken":"[redacted]","refresh_token":"[redacted]"}')
    assert.equal(redact('{"pw":"x\\"y"}'), '{"pw":"x\\"y"}', 'non-sensitive keys untouched')
    assert.equal(redact('{"password":"a\\"b"}'), '{"password":"[redacted]"}', 'escaped quotes stay inside the value')
    JSON.parse(redact(JSON.stringify({ password: 'p"w', nested: { apiKey: 'k' } })))
  })

  it('leaves non-sensitive JSON keys alone', () => {
    const text = '{"keyboard":"qwerty","token_count":"12345678","max_tokens":"4096","name":"Ada"}'
    assert.equal(redact(text), text)
  })
})

describe('redact: env-style names', () => {
  it('redacts names containing SECRET/TOKEN/KEY/PASSWORD/PASSWD/CREDENTIAL', () => {
    assert.equal(redact('AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG'), 'AWS_SECRET_ACCESS_KEY=[redacted]')
    assert.equal(redact('GITHUB_TOKEN=abcdef123456'), 'GITHUB_TOKEN=[redacted]')
    assert.equal(redact('export OPENAI_API_KEY="abc def"'), 'export OPENAI_API_KEY=[redacted]')
    assert.equal(redact('DB_PASSWD=topsecret'), 'DB_PASSWD=[redacted]')
    assert.equal(redact('GOOGLE_CREDENTIALS=/path/to/creds.json'), 'GOOGLE_CREDENTIALS=[redacted]')
    assert.equal(redact('STRIPE_KEY=rk_live_123456'), 'STRIPE_KEY=[redacted]')
    assert.equal(redact('A=1\nNPM_TOKEN=abcdef123\nB=2'), 'A=1\nNPM_TOKEN=[redacted]\nB=2')
  })

  it('redacts query-string tokens without eating the next parameter', () => {
    assert.equal(redact('https://x.dev/cb?token=abcdef123&page=2'), 'https://x.dev/cb?token=[redacted]&page=2')
  })
})

describe('redact: URL credentials', () => {
  it('keeps the user and hides the password', () => {
    assert.equal(redact('https://user:pass@host.example/path'), 'https://user:[redacted]@host.example/path')
    assert.equal(redact('DATABASE_URL=postgres://admin:s3cr3t@db:5432/app'), 'DATABASE_URL=postgres://admin:[redacted]@db:5432/app')
    assert.equal(redact('git clone https://oauth2:abc@gitlab.example/x.git'), 'git clone https://oauth2:[redacted]@gitlab.example/x.git')
  })

  it('leaves URLs without credentials alone', () => {
    for (const url of ['https://host.example:8080/a', 'https://user@host.example/a', 'http://127.0.0.1:47900/?x=1']) assert.equal(redact(url), url)
  })
})

describe('redact: CLI flags', () => {
  it('redacts space-separated and = flag values', () => {
    assert.equal(redact('mysql --password x --user root'), 'mysql --password [redacted] --user root')
    assert.equal(redact('cli --token abcdef'), 'cli --token [redacted]')
    assert.equal(redact('cli --api-key k1 --verbose'), 'cli --api-key [redacted] --verbose')
    assert.equal(redact('cli --password=hunter2'), 'cli --password=[redacted]')
    assert.equal(redact('cli --secret "a b c" next'), 'cli --secret [redacted] next')
  })

  it('does not treat the next flag as a value', () => {
    assert.equal(redact('cli --token --verbose'), 'cli --token --verbose')
    assert.equal(redact('cli --keyboard us --model opus'), 'cli --keyboard us --model opus')
  })
})

describe('redact: quoted values with spaces', () => {
  it('redacts the whole quoted value', () => {
    assert.equal(redact('secret: "a b c"'), 'secret: [redacted]')
    assert.equal(redact("password = 'correct horse battery'"), 'password = [redacted]')
  })
})

describe('redact: prose is not over-redacted', () => {
  it('keeps ordinary sentences', () => {
    for (const text of [
      'the token count is high',
      'press any key on the keyboard',
      'max_tokens=4096',
      'token_count: 123456789',
      'keyboard: logitech',
      'Use the password field below.',
      'Notes on secrets: rotate weekly',
      'PWD=/home/user/project',
      'run --model opus --worktree new-child'
    ]) assert.equal(redact(text), text)
  })
})

describe('isSensitiveKey', () => {
  it('classifies key names', () => {
    for (const key of ['password', 'PASSWORD', 'passwd', 'secret', 'client_secret', 'token', 'GITHUB_TOKEN', 'accessToken', 'api_key', 'api-key', 'apiKey', 'apikey', 'AWS_SECRET_ACCESS_KEY', 'MY_KEY', 'privateKey', 'credentials', 'authorization', 'DB_PASS']) {
      assert.equal(isSensitiveKey(key), true, key)
    }
    for (const key of ['keyboard', 'key', 'monkey', 'token_count', 'max_tokens', 'tokens', 'secretary', 'PWD', 'pass', 'name', 'sort_key']) {
      assert.equal(isSensitiveKey(key), false, key)
    }
  })
})

describe('redactAndTruncate', () => {
  it('redacts before cutting, so no partial key survives', () => {
    const key = 'sk-ant-api03-' + 'a'.repeat(40)
    const out = redactAndTruncate(`key ${key} trailing text`, 12)
    assert.ok(!out.includes('sk-ant'), out)
    assert.ok(!out.includes('aaaa'), out)
    assert.ok(out.length <= 12)
    // Truncating first would have cut the key below the pattern's minimum length and leaked it.
    assert.ok(redact(truncate(`key ${key}`, 20)).includes('sk-ant'), 'sanity: the naive order leaks')
  })

  it('keeps short text as is after redaction', () => {
    assert.equal(redactAndTruncate('password=hunter22', 100), 'password=[redacted]')
  })
})

describe('redactLines', () => {
  it('catches private key blocks split across lines', () => {
    const lines = ['before', '-----BEGIN OPENSSH PRIVATE KEY-----', 'b3BlbnNzaC1rZXk', '-----END OPENSSH PRIVATE KEY-----', 'after']
    const out = redactLines(lines)
    assert.ok(!out.join('\n').includes('b3BlbnNzaC1rZXk'))
    assert.deepEqual(out, ['before', '[redacted-private-key]', 'after'])
  })

  it('redacts per-line secrets and keeps line structure', () => {
    assert.deepEqual(redactLines(['ok', 'GITHUB_TOKEN=abcdef123', '']), ['ok', 'GITHUB_TOKEN=[redacted]', ''])
    assert.deepEqual(redactLines([]), [])
  })
})

describe('redact: a non-secret value never hides a following secret', () => {
  it('finds tokens after other assignments', () => {
    assert.equal(redact('a=b,token=abcdef123'), 'a=b,token=[redacted]')
    assert.equal(redact('name: x password: hunter22'), 'name: x password: [redacted]')
    assert.equal(redact('{"user":"ada","password":"pw"}'), '{"user":"ada","password":"[redacted]"}')
    assert.equal(redact('cli --user ada --token abc'), 'cli --user ada --token [redacted]')
  })
})
