// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  startReplay,
  rotateReplayLogs,
  redactEnv,
  shouldRedactKey,
} from '../../src/utils/replay.js'

let testDir: string
let baseDir: string
let projectDir: string

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), 'replay-'))
  baseDir = join(testDir, 'logs')
  projectDir = join(testDir, 'project')
  mkdirSync(projectDir, { recursive: true })
})

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true })
})

// ─── Redaction matrix (#638 S001 mitigation surface) ─────────────────────────
// @Security:S001 — env redaction patterns. Verifies the documented pattern set
// catches every flavour of secret-bearing env var we ship redaction rules for.

describe('shouldRedactKey', () => {
  const positives = [
    'GITHUB_TOKEN',
    'GH_TOKEN',
    'NPM_TOKEN',
    'API_KEY',
    'OPENAI_API_KEY',
    'SECRET_VALUE',
    'AWS_SECRET_ACCESS_KEY',
    'USER_PASSWORD',
    'CREDENTIAL_BLOB',
    'session_auth',
    'github_token',
  ]
  for (const key of positives) {
    it(`redacts ${key}`, () => {
      expect(shouldRedactKey(key)).toBe(true)
    })
  }

  const negatives = ['PATH', 'HOME', 'USER', 'ARBITER_LOG_LEVEL', 'PWD']
  for (const key of negatives) {
    it(`keeps ${key}`, () => {
      expect(shouldRedactKey(key)).toBe(false)
    })
  }

  // #1573: key-name heuristic extensions — DSN segment + run-together compounds.
  const extendedPositives = ['SENTRY_DSN', 'APP_DSN', 'APIKEY', 'MYAPITOKEN', 'PRIVATEKEY']
  for (const key of extendedPositives) {
    it(`redacts ${key} (extended heuristic)`, () => {
      expect(shouldRedactKey(key)).toBe(true)
    })
  }

  // Compound-word matching must NOT over-redact these benign run-together keys.
  const extendedNegatives = ['MONKEY', 'COMPASS', 'AUTHOR']
  for (const key of extendedNegatives) {
    it(`keeps ${key} (no false-positive from compound match)`, () => {
      expect(shouldRedactKey(key)).toBe(false)
    })
  }
})

describe('redactEnv', () => {
  it('replaces sensitive values with REDACTED while keeping benign ones', () => {
    const out = redactEnv({
      PATH: '/usr/bin',
      GITHUB_TOKEN: 'ghp_xxxx',
      OPENAI_API_KEY: 'sk-xxxx',
      USER: 'alice',
    })
    expect(out.PATH).toBe('/usr/bin')
    expect(out.GITHUB_TOKEN).toBe('***REDACTED***')
    expect(out.OPENAI_API_KEY).toBe('***REDACTED***')
    expect(out.USER).toBe('alice')
  })

  // #1573: value-based pass — connection strings carry `user:pass@` userinfo whose
  // KEY name trips none of the keyword heuristics, yet the VALUE is a cleartext secret.
  it('redacts connection-string values with embedded user:pass@ userinfo', () => {
    const out = redactEnv({
      DATABASE_URL: 'postgres://user:secretpass@host:5432/db',
      REDIS_URL: 'redis://default:hunter2@cache:6379',
      MONGODB_URI: 'mongodb://admin:s3cr3t@mongo/app',
      AMQP_URL: 'amqp://guest:guestpw@broker:5672',
    })
    expect(out.DATABASE_URL).toBe('***REDACTED***')
    expect(out.REDIS_URL).toBe('***REDACTED***')
    expect(out.MONGODB_URI).toBe('***REDACTED***')
    expect(out.AMQP_URL).toBe('***REDACTED***')
  })

  it('redacts a SENTRY_DSN value via the userinfo value pass', () => {
    const out = redactEnv({ SENTRY_DSN: 'https://pubkey:privkey@o0.ingest.sentry.io/1' })
    expect(out.SENTRY_DSN).toBe('***REDACTED***')
  })

  it('keeps a benign connection string with no userinfo (preserves diagnostic value)', () => {
    // Locked behaviour (#1573): no embedded credential → not redacted, the URL stays
    // visible for replay diagnostics. The key name alone does not imply a secret.
    const out = redactEnv({ DATABASE_URL: 'postgres://db-host:5432/app' })
    expect(out.DATABASE_URL).toBe('postgres://db-host:5432/app')
  })
})

// ─── startReplay / close ─────────────────────────────────────────────────────

describe('startReplay / close', () => {
  it('writes all 5 files synchronously', () => {
    const handle = startReplay({
      runId: 'r1',
      argv: ['arbiter', 'doctor'],
      env: { PATH: '/usr/bin', GITHUB_TOKEN: 'ghp_xxx' },
      cwd: projectDir,
      baseDir,
    })
    handle.append('out line 1\n')
    handle.append('out line 2\n')
    handle.close(0)

    const dir = join(baseDir, 'r1')
    expect(existsSync(join(dir, 'command.txt'))).toBe(true)
    expect(existsSync(join(dir, 'env.json'))).toBe(true)
    expect(existsSync(join(dir, 'state-before.json'))).toBe(true)
    expect(existsSync(join(dir, 'state-after.json'))).toBe(true)
    expect(existsSync(join(dir, 'output.log'))).toBe(true)

    expect(readFileSync(join(dir, 'command.txt'), 'utf-8')).toContain('arbiter doctor')
    const env = JSON.parse(readFileSync(join(dir, 'env.json'), 'utf-8')) as Record<string, string>
    expect(env.GITHUB_TOKEN).toBe('***REDACTED***')
    expect(env.PATH).toBe('/usr/bin')
    expect(readFileSync(join(dir, 'output.log'), 'utf-8')).toBe('out line 1\nout line 2\n')

    const after = JSON.parse(readFileSync(join(dir, 'state-after.json'), 'utf-8')) as {
      exitCode: number
    }
    expect(after.exitCode).toBe(0)
  })

  it('captures arbiter.json snapshot when present', () => {
    writeFileSync(join(projectDir, 'arbiter.json'), JSON.stringify({ version: 1, level: 'L2' }))
    const handle = startReplay({
      runId: 'r2',
      argv: ['arbiter', 'doctor'],
      env: {},
      cwd: projectDir,
      baseDir,
    })
    handle.close(0)
    const before = JSON.parse(readFileSync(join(baseDir, 'r2', 'state-before.json'), 'utf-8')) as {
      arbiterJson?: { version: number; level: string }
    }
    expect(before.arbiterJson?.level).toBe('L2')
  })

  it('captures .arbiter/ directory listing', () => {
    mkdirSync(join(projectDir, '.arbiter', 'evidence'), { recursive: true })
    writeFileSync(join(projectDir, '.arbiter', 'evidence', 'a.json'), '{}')
    const handle = startReplay({
      runId: 'r3',
      argv: ['arbiter', 'doctor'],
      env: {},
      cwd: projectDir,
      baseDir,
    })
    handle.close(0)
    const before = JSON.parse(readFileSync(join(baseDir, 'r3', 'state-before.json'), 'utf-8')) as {
      arbiterDir?: string[]
    }
    expect(before.arbiterDir).toContain(join('evidence', 'a.json'))
  })
})

// ─── LRU rotation ────────────────────────────────────────────────────────────

describe('rotateReplayLogs', () => {
  it('keeps capN most recent dirs, evicts older', () => {
    for (let i = 0; i < 5; i++) {
      const sub = join(baseDir, `r${i}`)
      mkdirSync(sub, { recursive: true })
      const t = (i + 1) * 1000
      utimesSync(sub, t, t)
    }
    const evicted = rotateReplayLogs({ baseDir, capN: 3 })
    expect(evicted.sort()).toEqual(['r0', 'r1'])
    expect(existsSync(join(baseDir, 'r0'))).toBe(false)
    expect(existsSync(join(baseDir, 'r4'))).toBe(true)
  })

  it('no-op when count ≤ capN', () => {
    mkdirSync(join(baseDir, 'r0'), { recursive: true })
    expect(rotateReplayLogs({ baseDir, capN: 10 })).toEqual([])
  })

  it('no-op when baseDir does not exist', () => {
    expect(rotateReplayLogs({ baseDir: join(testDir, 'never'), capN: 3 })).toEqual([])
  })
})
