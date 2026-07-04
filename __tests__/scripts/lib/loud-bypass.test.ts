// SPDX-License-Identifier: Apache-2.0
// __tests__/scripts/lib/loud-bypass.test.ts
//
// Loud-bypass contract (Workstream C Port #10).
//
// Contract (RED-TEAM B2 amended):
//   - value === 'true' (exact string)  → { bypassed: true,  ... }, stderr warn line, JSONL append
//   - ambiguous values ('1','yes','TRUE','on', any other non-empty) → { bypassed: false }
//                                          + LOUD stderr warning, JSONL append, **never exit non-zero**
//   - unset env var or '' → { bypassed: false }, silent, NO JSONL append
//
// N6 amendment: stderr format is arbiter-specific (key=value with `arbiter-bypass` token).
// Negative regex test asserts stderr does NOT match a prior internal convention's `[BYPASS]` pattern.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'

const LIB = pathToFileURL(resolve('scripts/lib/loud-bypass.mjs')).href

interface HarnessResult {
  status: number | null
  stdout: string
  stderr: string
  payload: {
    bypassed: boolean
    reason?: string
    branch?: string
    ts?: string
  }
}

/**
 * Invoke checkBypass in a child process so we can assert exit code, stderr,
 * and inspect the JSONL log path deterministically.
 */
function invoke(
  envName: string,
  envValue: string | undefined,
  opts: { reason?: string; logPath: string; branch?: string; now?: string },
): HarnessResult {
  const script = `
    import { checkBypass } from ${JSON.stringify(LIB)};
    const ts = ${opts.now ? JSON.stringify(opts.now) : 'undefined'};
    const result = checkBypass(${JSON.stringify(envName)}, {
      reason: ${JSON.stringify(opts.reason ?? 'test bypass')},
      logPath: ${JSON.stringify(opts.logPath)},
      branch: ${JSON.stringify(opts.branch ?? 'task/#970-loud-bypass')},
      now: ts ? () => new Date(ts) : undefined,
    });
    process.stdout.write(JSON.stringify(result));
  `

  // Build env without the target var; add it back only if envValue is provided
  const baseEnv: NodeJS.ProcessEnv = { ...process.env, NO_COLOR: '1' }
  const env: NodeJS.ProcessEnv = Object.fromEntries(
    Object.entries(baseEnv).filter(([k]) => k !== envName),
  )
  if (envValue !== undefined) {
    env[envName] = envValue
  }

  const r = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    encoding: 'utf-8',
    env,
  })

  let payload: HarnessResult['payload'] = { bypassed: false }
  try {
    payload = JSON.parse(r.stdout.trim() || '{}')
  } catch {
    /* leave default */
  }

  return {
    status: r.status,
    stdout: r.stdout,
    stderr: r.stderr,
    payload,
  }
}

function readJsonl(path: string): Array<Record<string, unknown>> {
  if (!existsSync(path)) return []
  const txt = readFileSync(path, 'utf-8')
  return txt
    .split('\n')
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l) as Record<string, unknown>)
}

describe('loud-bypass — checkBypass contract', () => {
  let tmpDir: string
  let logPath: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'loud-bypass-'))
    logPath = join(tmpDir, 'bypass-log.jsonl')
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  // ─── Table-driven core contract ────────────────────────────────────────────

  const TABLE: Array<{
    label: string
    value: string | undefined
    expectedBypassed: boolean
    expectsStderrLine: boolean
    expectsJsonl: boolean
  }> = [
    {
      label: "exact 'true'",
      value: 'true',
      expectedBypassed: true,
      expectsStderrLine: true,
      expectsJsonl: true,
    },
    {
      label: "ambiguous '1'",
      value: '1',
      expectedBypassed: false,
      expectsStderrLine: true,
      expectsJsonl: true,
    },
    {
      label: "ambiguous 'yes'",
      value: 'yes',
      expectedBypassed: false,
      expectsStderrLine: true,
      expectsJsonl: true,
    },
    {
      label: "ambiguous 'TRUE'",
      value: 'TRUE',
      expectedBypassed: false,
      expectsStderrLine: true,
      expectsJsonl: true,
    },
    {
      label: "ambiguous 'on'",
      value: 'on',
      expectedBypassed: false,
      expectsStderrLine: true,
      expectsJsonl: true,
    },
    {
      label: "ambiguous 'false'",
      value: 'false',
      expectedBypassed: false,
      expectsStderrLine: true,
      expectsJsonl: true,
    },
    {
      label: 'empty string',
      value: '',
      expectedBypassed: false,
      expectsStderrLine: false,
      expectsJsonl: false,
    },
    {
      label: 'undefined (unset)',
      value: undefined,
      expectedBypassed: false,
      expectsStderrLine: false,
      expectsJsonl: false,
    },
  ]

  for (const row of TABLE) {
    it(`${row.label} → bypassed=${row.expectedBypassed}, exit 0`, () => {
      const r = invoke('ARBITER_FOO_BYPASS', row.value, { logPath })

      // INVARIANT (B2): never exit non-zero, never throw
      expect(r.status).toBe(0)

      expect(r.payload.bypassed).toBe(row.expectedBypassed)

      if (row.expectsStderrLine) {
        // arbiter-specific log format token
        expect(r.stderr).toMatch(/arbiter-bypass\b/)
        expect(r.stderr).toMatch(/env=ARBITER_FOO_BYPASS\b/)
      } else {
        expect(r.stderr).not.toMatch(/arbiter-bypass\b/)
      }

      // N6: stderr must NEVER match a prior internal convention's bracketed pattern
      expect(r.stderr).not.toMatch(/\[BYPASS\]/)

      const lines = readJsonl(logPath)
      if (row.expectsJsonl) {
        expect(lines).toHaveLength(1)
        expect(lines[0]).toMatchObject({
          env: 'ARBITER_FOO_BYPASS',
          bypassed: row.expectedBypassed,
        })
        expect(typeof lines[0].ts).toBe('string')
        expect(typeof lines[0].branch).toBe('string')
      } else {
        expect(lines).toHaveLength(0)
      }
    })
  }

  // ─── Bypass case detail ────────────────────────────────────────────────────

  it("bypass case ('true') returns reason, branch, ts and emits structured log", () => {
    const now = '2026-05-20T18:30:00.000Z'
    const r = invoke('ARBITER_FOO_BYPASS', 'true', {
      logPath,
      reason: 'emergency hotfix',
      branch: 'task/#970-loud-bypass',
      now,
    })

    expect(r.status).toBe(0)
    expect(r.payload).toMatchObject({
      bypassed: true,
      reason: 'emergency hotfix',
      branch: 'task/#970-loud-bypass',
      ts: now,
    })

    // Loud stderr line — arbiter format, not a prior internal convention's
    expect(r.stderr).toMatch(
      /arbiter-bypass env=ARBITER_FOO_BYPASS branch=task\/#970-loud-bypass at=2026-05-20T18:30:00\.000Z reason="emergency hotfix"/,
    )
    expect(r.stderr).not.toMatch(/\[BYPASS\]/)

    const lines = readJsonl(logPath)
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatchObject({
      env: 'ARBITER_FOO_BYPASS',
      branch: 'task/#970-loud-bypass',
      ts: now,
      value: 'true',
      bypassed: true,
      reason: 'emergency hotfix',
    })
  })

  // ─── Ambiguous case detail ─────────────────────────────────────────────────

  it("ambiguous case ('yes') warns, returns bypassed=false, does NOT exit 1", () => {
    const r = invoke('ARBITER_FOO_BYPASS', 'yes', { logPath })

    // CRITICAL B2: must not exit 1 even though the value looks "truthy"
    expect(r.status).toBe(0)

    expect(r.payload.bypassed).toBe(false)

    // Warning identifies the value as ambiguous
    expect(r.stderr).toMatch(/arbiter-bypass\b/)
    expect(r.stderr).toMatch(/reason=".*ambiguous.*'yes'.*"/)

    const lines = readJsonl(logPath)
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatchObject({
      env: 'ARBITER_FOO_BYPASS',
      value: 'yes',
      bypassed: false,
    })
    expect(String(lines[0].reason)).toMatch(/ambiguous/)
  })

  // ─── Silent unset case ─────────────────────────────────────────────────────

  it('unset env var is silent (no stderr, no JSONL)', () => {
    const r = invoke('ARBITER_FOO_BYPASS', undefined, { logPath })
    expect(r.status).toBe(0)
    expect(r.payload.bypassed).toBe(false)
    expect(r.stderr).toBe('')
    expect(existsSync(logPath)).toBe(false)
  })

  // ─── Defensive: function never throws even with weird inputs ───────────────

  it('does not throw when logPath directory does not exist (auto-creates)', () => {
    const nested = join(tmpDir, 'does', 'not', 'exist', 'log.jsonl')
    const r = invoke('ARBITER_FOO_BYPASS', 'true', { logPath: nested })
    expect(r.status).toBe(0)
    expect(r.payload.bypassed).toBe(true)
    expect(existsSync(nested)).toBe(true)
  })

  // ─── Legacy envs are not affected ──────────────────────────────────────────

  it('does not consume legacy ARBITER_SKIP_TDD contract (different env name)', () => {
    // Sanity: this lib is keyed only on the env name passed to checkBypass.
    // It must not magically inspect ARBITER_SKIP_TDD.
    const env: NodeJS.ProcessEnv = { ...process.env, NO_COLOR: '1', ARBITER_SKIP_TDD: '1' }
    delete env.ARBITER_GATE_BYPASS
    const script = `
      import { checkBypass } from ${JSON.stringify(LIB)};
      const r = checkBypass('ARBITER_GATE_BYPASS', { logPath: ${JSON.stringify(logPath)} });
      process.stdout.write(JSON.stringify(r));
    `
    const r = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
      encoding: 'utf-8',
      env,
    })
    expect(r.status).toBe(0)
    expect(JSON.parse(r.stdout.trim())).toMatchObject({ bypassed: false })
    expect(r.stderr).toBe('')
  })
})

describe('loud-bypass — log-bypass.mjs CLI wrapper', () => {
  let tmpDir: string
  let logPath: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'log-bypass-cli-'))
    logPath = join(tmpDir, 'bypass-log.jsonl')
  })

  const WRAPPER = resolve('scripts/lib/log-bypass.mjs')

  it('argv[2]=env name, argv[3]=reason — invokes checkBypass and exits 0 on bypass', () => {
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      NO_COLOR: '1',
      ARBITER_FOO_BYPASS: 'true',
      ARBITER_BYPASS_LOG_PATH: logPath,
      ARBITER_BYPASS_BRANCH: 'task/#970-loud-bypass',
    }
    const r = spawnSync(process.execPath, [WRAPPER, 'ARBITER_FOO_BYPASS', 'pipeline broken'], {
      encoding: 'utf-8',
      env,
    })
    expect(r.status).toBe(0)
    expect(r.stderr).toMatch(/arbiter-bypass env=ARBITER_FOO_BYPASS\b/)
    expect(r.stderr).toMatch(/reason="pipeline broken"/)
    expect(r.stderr).not.toMatch(/\[BYPASS\]/)

    const lines = readJsonl(logPath)
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatchObject({ env: 'ARBITER_FOO_BYPASS', bypassed: true })
  })

  it('exits 0 on ambiguous value (never propagates failure)', () => {
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      NO_COLOR: '1',
      ARBITER_FOO_BYPASS: '1',
      ARBITER_BYPASS_LOG_PATH: logPath,
    }
    const r = spawnSync(process.execPath, [WRAPPER, 'ARBITER_FOO_BYPASS'], {
      encoding: 'utf-8',
      env,
    })
    expect(r.status).toBe(0)
    expect(r.stderr).toMatch(/ambiguous/)
  })

  it('exits 0 silently when env var unset', () => {
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      NO_COLOR: '1',
      ARBITER_BYPASS_LOG_PATH: logPath,
    }
    delete env.ARBITER_FOO_BYPASS
    const r = spawnSync(process.execPath, [WRAPPER, 'ARBITER_FOO_BYPASS'], {
      encoding: 'utf-8',
      env,
    })
    expect(r.status).toBe(0)
    expect(r.stderr).toBe('')
    expect(existsSync(logPath)).toBe(false)
  })

  it('prints usage to stderr and exits 0 when no env name argument', () => {
    const r = spawnSync(process.execPath, [WRAPPER], { encoding: 'utf-8' })
    // Even on usage error, the wrapper must not propagate failure
    expect(r.status).toBe(0)
    expect(r.stderr.toLowerCase()).toMatch(/usage|env name/)
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })
})
