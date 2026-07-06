// SPDX-License-Identifier: Apache-2.0
// RED phase (#1445, INV-130): a stack-agnostic E2E reliability subsystem must be
// emitted into targets — a reliability library (fingerprint / classify / retryLadder /
// riskTier / ledger / quarantine schema) plus a fail-closed quarantine hygiene gate
// wired into the generated check-all.mjs at L1. The gate ANNOTATES but never suppresses:
// an expired or malformed quarantine entry fails closed; an absent registry self-SKIPs.
import { describe, it, expect, beforeAll } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { renderTemplate } from '../../src/utils/render.js'
import { makeConfig } from '../helpers.js'

function render(tpl: string, overrides: Record<string, unknown> = {}): string {
  const data = makeConfig('/tmp/test', overrides as never) as unknown as Record<string, unknown>
  return renderTemplate(tpl, data)
}
const renderLib = () => render('scripts/lib/e2e-reliability.mjs.ejs')
const renderGate = () => render('scripts/check-e2e-quarantine.mjs.ejs')
const renderCheckAll = (o: Record<string, unknown> = {}) => render('scripts/check-all.mjs.ejs', o)

/**
 * Materialise the gate + its lib dependency into a temp script dir, drop an optional
 * quarantine registry into a temp repo dir, run the gate, return the exit code.
 */
function runGate(registry: string | object | null): number {
  const scriptDir = mkdtempSync(join(tmpdir(), 'e2eq-s-'))
  const repoDir = mkdtempSync(join(tmpdir(), 'e2eq-r-'))
  try {
    mkdirSync(join(scriptDir, 'lib'), { recursive: true })
    writeFileSync(join(scriptDir, 'lib', 'e2e-reliability.mjs'), renderLib())
    writeFileSync(join(scriptDir, 'check-e2e-quarantine.mjs'), renderGate())
    if (registry !== null) {
      mkdirSync(join(repoDir, '.arbiter', 'e2e'), { recursive: true })
      const body = typeof registry === 'string' ? registry : JSON.stringify(registry)
      writeFileSync(join(repoDir, '.arbiter', 'e2e', 'quarantine.json'), body)
    }
    const r = spawnSync('node', [join(scriptDir, 'check-e2e-quarantine.mjs'), '--dir', repoDir], {
      encoding: 'utf-8',
    })
    return r.status ?? -1
  } finally {
    rmSync(scriptDir, { recursive: true, force: true })
    rmSync(repoDir, { recursive: true, force: true })
  }
}

// A complete, valid, unexpired quarantine entry.
const validEntry = (overrides: Record<string, unknown> = {}) => ({
  id: 'flaky-checkout-redirect',
  fingerprint: 'fp_0123456789abcdef',
  reason: 'intermittent redirect race under load',
  owner: 'team-payments',
  added: '2026-01-01',
  expires: '2999-01-01',
  issue: '#9999',
  ...overrides,
})

// Dynamically import the rendered library so the actual functions are exercised.
type ReliabilityLib = {
  fingerprint: (s: unknown) => string
  classify: (f: unknown, o?: { quarantined?: Iterable<string> }) => string
  retryLadder: (
    run: (scope: string) => { passed: boolean; failures?: unknown[] },
    o?: Record<string, unknown>,
  ) => { verdict: string; attempts: unknown[] }
  riskTier: (s: unknown) => string
  validateQuarantine: (r: unknown, now?: Date) => { ok: boolean; errors: string[] }
  QUARANTINE_REQUIRED_FIELDS: string[]
}
let lib: ReliabilityLib
beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), 'e2eq-lib-'))
  const file = join(dir, 'e2e-reliability.mjs')
  writeFileSync(file, renderLib())
  lib = (await import(pathToFileURL(file).href)) as unknown as ReliabilityLib
})

describe('scripts/lib/e2e-reliability.mjs.ejs — reliability library (#1445)', () => {
  it('fingerprint is deterministic and normalises volatile tokens (TS, uuid, port)', () => {
    const a = lib.fingerprint('failed at 2026-06-20T10:00:00.123Z on host:54321')
    const b = lib.fingerprint('failed at 2026-06-20T11:30:55.900Z on host:12000')
    expect(a).toBe(b) // timestamps + ports normalised away → same identity
    expect(a.startsWith('fp_')).toBe(true)
    expect(lib.fingerprint('a different assertion')).not.toBe(a)
  })

  it('classify: environmental fault → INFRA', () => {
    expect(lib.classify({ message: 'connect ECONNREFUSED 127.0.0.1:5432' })).toBe('INFRA')
    expect(lib.classify({ message: 'received HTTP 503 from upstream' })).toBe('INFRA')
  })

  it('classify: quarantined fingerprint → FLAKE, unknown → REGRESSION (fail-closed)', () => {
    const fp = lib.fingerprint('expected 2 to equal 3')
    expect(lib.classify({ message: 'expected 2 to equal 3' }, { quarantined: [fp] })).toBe('FLAKE')
    expect(lib.classify({ message: 'expected 2 to equal 3' })).toBe('REGRESSION')
    expect(lib.classify(null)).toBe('REGRESSION')
    expect(lib.classify('not an object' as unknown)).toBe('REGRESSION')
  })

  it('riskTier escalates and fail-closes to R4', () => {
    expect(lib.riskTier({})).toBe('R0')
    expect(lib.riskTier({ flakes: 2 })).toBe('R1')
    expect(lib.riskTier({ infra: 1 })).toBe('R2')
    expect(lib.riskTier({ expiredQuarantine: 1 })).toBe('R3')
    expect(lib.riskTier({ regressions: 1 })).toBe('R4')
    expect(lib.riskTier(null)).toBe('R4') // malformed → fail-closed
    expect(lib.riskTier(undefined)).toBe('R4')
  })

  it('retryLadder: pass-first → PASS, pass-on-retry → FLAKE', () => {
    expect(lib.retryLadder(() => ({ passed: true })).verdict).toBe('PASS')
    let n = 0
    const flaky = lib.retryLadder(() => {
      n++
      return n === 1
        ? { passed: false, failures: [{ message: 'expected 1 to equal 2' }] }
        : { passed: true }
    })
    expect(flaky.verdict).toBe('FLAKE')
  })

  it('retryLadder: all-infra short-circuits to INFRA; persistent → REGRESSION; throw → REGRESSION', () => {
    expect(
      lib.retryLadder(() => ({ passed: false, failures: [{ message: 'ETIMEDOUT' }] })).verdict,
    ).toBe('INFRA')
    expect(
      lib.retryLadder(() => ({ passed: false, failures: [{ message: 'expected x to equal y' }] }))
        .verdict,
    ).toBe('REGRESSION')
    expect(
      lib.retryLadder(() => {
        throw new Error('runner exploded')
      }).verdict,
    ).toBe('REGRESSION')
  })

  // ── A3 (#1817): @smoke tier = 0 retries, non-bypassable ──────────────────────
  it('retryLadder: tier "smoke" truncates the ladder to a single attempt on failure', () => {
    let calls = 0
    const result = lib.retryLadder(
      () => {
        calls++
        return { passed: false, failures: [{ message: 'expected 1 to equal 2' }] }
      },
      { tier: 'smoke', scopes: ['initial', 'single-test', 'spec'] },
    )
    expect(calls).toBe(1)
    expect(result.attempts.length).toBe(1)
    expect(result.verdict).toBe('REGRESSION')
  })

  it('retryLadder: tier "smoke" still PASSes on a clean first attempt (no retry needed)', () => {
    let calls = 0
    const result = lib.retryLadder(
      () => {
        calls++
        return { passed: true }
      },
      { tier: 'smoke', scopes: ['initial', 'single-test', 'spec'] },
    )
    expect(calls).toBe(1)
    expect(result.attempts.length).toBe(1)
    expect(result.verdict).toBe('PASS')
  })

  it('retryLadder: tier "smoke" ignores caller-supplied multi-scope opts.scopes (non-bypassable)', () => {
    const result = lib.retryLadder(() => ({ passed: false, failures: [{ message: 'ETIMEDOUT' }] }), {
      tier: 'smoke',
      scopes: ['initial', 'single-test', 'spec', 'full-suite'],
    })
    expect(result.attempts.length).toBe(1)
    // classification still applies on the single attempt (INFRA short-circuit, not a bypass of classify)
    expect(result.verdict).toBe('INFRA')
  })

  it('exposes the quarantine field contract', () => {
    expect(lib.QUARANTINE_REQUIRED_FIELDS).toEqual(
      expect.arrayContaining(['id', 'fingerprint', 'reason', 'owner', 'added', 'expires', 'issue']),
    )
  })
})

describe('scripts/check-e2e-quarantine.mjs.ejs — fail-closed quarantine gate (#1445)', () => {
  it('renders an executable node gate with shebang and INV-53 exit codes', () => {
    const content = renderGate()
    expect(content.startsWith('#!/usr/bin/env node')).toBe(true)
    expect(content).toContain('process.exit(1)')
    expect(content).toContain('process.exit(0)')
    expect(content).toContain('process.exit(2)')
  })

  // ── A/B/C fail-closed harness ───────────────────────────────────────────────
  it('A: exits 0 when no quarantine registry exists (self-SKIP)', () => {
    expect(runGate(null)).toBe(0)
  })

  it('B: exits 0 for a complete, unexpired entry (annotates, never suppresses)', () => {
    expect(runGate({ entries: [validEntry()] })).toBe(0)
    expect(runGate([validEntry()])).toBe(0) // bare-array form also accepted
  })

  it('C: exits 1 on an EXPIRED quarantine entry', () => {
    expect(runGate({ entries: [validEntry({ expires: '2000-01-01' })] })).toBe(1)
  })

  it('C: exits 1 on a MISSING required field', () => {
    const e = validEntry()
    delete (e as Record<string, unknown>).owner
    expect(runGate({ entries: [e] })).toBe(1)
  })

  it('C: exits 1 on a malformed (non-JSON) registry', () => {
    expect(runGate('{ this is not json ')).toBe(1)
  })
})

describe('check-all.mjs wiring (#1445) — cross-stack', () => {
  for (const language of ['typescript', 'go', 'python', 'java'] as const) {
    it(`wires the e2e quarantine gate at L1 for ${language}`, () => {
      expect(renderCheckAll({ language, governanceLevel: 'L1' })).toContain(
        'check-e2e-quarantine.mjs',
      )
    })
  }
})
