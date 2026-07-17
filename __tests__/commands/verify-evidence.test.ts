import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { computeSummarySha } from '../../src/risk/sha-check.js'
import { runVerifyEvidence } from '../../src/commands/verify.js'

function makeSummary(overrides: Record<string, unknown> = {}): {
  body: Record<string, unknown>
  serialised: string
} {
  const body: Record<string, unknown> = {
    stack: 'typescript',
    files: ['src/api/users.ts', 'docs/intro.md'],
    timestamp: new Date().toISOString(),
    head_sha: 'abc123def456abc123def456abc123def456abc1',
    head_sha_short: 'abc123d',
    obs_gate: 'PASS',
    tests: { passed: 10, failed: 0, total: 10 },
    coverage: { line: 90, branch: 85 },
    mutation: { score: 82 },
    security: { critical: 0, high: 0 },
    ...overrides,
  }
  const sha = computeSummarySha(body)
  const finalBody = { ...body, sha }
  return { body: finalBody, serialised: JSON.stringify(finalBody, null, 2) }
}

describe('runVerifyEvidence (#238)', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'arbiter-evidence-'))
    mkdirSync(join(dir, '.evidence'), { recursive: true })
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('returns ok status when SUMMARY.json sha + freshness pass', () => {
    const { serialised } = makeSummary()
    writeFileSync(join(dir, '.evidence', 'SUMMARY.json'), serialised)
    const result = runVerifyEvidence({ dir })
    expect(result.exitCode).toBe(0)
    expect(result.status).toBe('ok')
  })

  it('surfaces aggregate riskLevel computed from files[]', () => {
    // src/auth/login.ts → R1, docs/intro.md → R4 → highest = R1
    const { serialised } = makeSummary({
      files: ['src/auth/login.ts', 'docs/intro.md'],
    })
    writeFileSync(join(dir, '.evidence', 'SUMMARY.json'), serialised)
    const result = runVerifyEvidence({ dir })
    expect(result.exitCode).toBe(0)
    expect(result.riskLevel).toBe('R1')
  })

  it('returns error+exit 2 when SUMMARY.json sha is corrupted', () => {
    const { body } = makeSummary()
    const tampered = { ...body, files: ['mutated'] } // sha now stale
    writeFileSync(join(dir, '.evidence', 'SUMMARY.json'), JSON.stringify(tampered, null, 2))
    const result = runVerifyEvidence({ dir })
    expect(result.exitCode).toBe(2)
    expect(result.status).toBe('error')
  })

  it('blocks (exit 2) when stale evidence covers an R2 (medium-risk) change set', () => {
    // Default fixture files include src/api/users.ts → R2
    const oldTs = new Date(Date.now() - 8 * 86_400_000).toISOString()
    const { serialised } = makeSummary({ timestamp: oldTs })
    writeFileSync(join(dir, '.evidence', 'SUMMARY.json'), serialised)
    const result = runVerifyEvidence({ dir })
    expect(result.status).toBe('error')
    expect(result.exitCode).toBe(2)
    expect(result.riskLevel).toBe('R2')
    expect(result.reason).toMatch(/high-risk/)
  })

  it('advises (exit 1) when stale evidence covers only low-risk files (R4)', () => {
    const oldTs = new Date(Date.now() - 8 * 86_400_000).toISOString()
    const { serialised } = makeSummary({
      timestamp: oldTs,
      files: ['docs/intro.md', 'README.md'],
    })
    writeFileSync(join(dir, '.evidence', 'SUMMARY.json'), serialised)
    const result = runVerifyEvidence({ dir })
    expect(result.status).toBe('warning')
    expect(result.exitCode).toBe(1)
    expect(result.riskLevel).toBe('R4')
  })

  it('advises (exit 1) and refuses to fail open on UNCLASSIFIED files', () => {
    const { serialised } = makeSummary({
      files: ['random/file.unknown-ext'],
    })
    writeFileSync(join(dir, '.evidence', 'SUMMARY.json'), serialised)
    const result = runVerifyEvidence({ dir })
    expect(result.status).toBe('warning')
    expect(result.exitCode).toBe(1)
    expect(result.riskLevel).toBe('R-unknown')
    expect(result.reason).toMatch(/manual review/)
  })

  it('falls back to legacy warning-only stale when files[] is absent', () => {
    // No files[] = cannot risk-gate, preserve advisory behaviour.
    const oldTs = new Date(Date.now() - 8 * 86_400_000).toISOString()
    const body: Record<string, unknown> = {
      stack: 'typescript',
      timestamp: oldTs,
    }
    const { serialised } = makeSummary(body)
    writeFileSync(join(dir, '.evidence', 'SUMMARY.json'), serialised)
    // Wipe files key (makeSummary preserves it from defaults — override fully)
    const parsed = JSON.parse(serialised) as Record<string, unknown>
    delete parsed['files']
    delete parsed['sha']
    const sha = computeSummarySha(parsed)
    writeFileSync(
      join(dir, '.evidence', 'SUMMARY.json'),
      JSON.stringify({ ...parsed, sha }, null, 2),
    )
    const result = runVerifyEvidence({ dir })
    expect(result.status).toBe('warning')
    expect(result.exitCode).toBe(1)
    expect(result.riskLevel).toBeUndefined()
  })

  it('returns error when SUMMARY.json is missing', () => {
    const result = runVerifyEvidence({ dir })
    expect(result.exitCode).toBe(1)
    expect(result.status).toBe('error')
  })

  // ── G1b unit 7 (#1316): persisted stack is honored over on-disk detection ────
  // The temp dir has NO go.mod, so detectLanguage(dir) returns 'unknown' and a
  // .go file would classify as R-unknown. With stack:'go' persisted in SUMMARY.json
  // the .go file must classify as R2 — proving resolveStack used the persisted
  // stack, not a re-detect that would skip the matrix. (Read path NOT re-edited.)
  it('honors persisted stack:go for classification even when the dir has no go.mod', () => {
    const { serialised } = makeSummary({
      stack: 'go',
      files: ['internal/handler/users.go'],
    })
    writeFileSync(join(dir, '.evidence', 'SUMMARY.json'), serialised)
    const result = runVerifyEvidence({ dir })
    expect(result.riskLevel).toBe('R2')
    expect(result.riskLevel).not.toBe('R-unknown')
  })

  it('respects E2E_RISK_SKIP env with valid <cat>:#<issue> reason', () => {
    const { serialised } = makeSummary()
    writeFileSync(join(dir, '.evidence', 'SUMMARY.json'), serialised)
    const orig = process.env['E2E_RISK_SKIP']
    process.env['E2E_RISK_SKIP'] = 'flake:#123'
    try {
      const result = runVerifyEvidence({ dir })
      expect(result.skipped).toBe(true)
      expect(result.exitCode).toBe(0)
      const skipLog = join(dir, '.evidence', 'skip-log.jsonl')
      expect(existsSync(skipLog)).toBe(true)
      const line = readFileSync(skipLog, 'utf-8').trim().split('\n').pop() ?? ''
      const parsed = JSON.parse(line)
      expect(parsed.reason).toBe('flake:#123')
      expect(typeof parsed.ts).toBe('string')
    } finally {
      if (orig === undefined) {
        delete process.env['E2E_RISK_SKIP']
      } else {
        process.env['E2E_RISK_SKIP'] = orig
      }
    }
  })

  it('accepts E2E_RISK_SKIP with optional slug (infra:#456:db-outage)', () => {
    const { serialised } = makeSummary()
    writeFileSync(join(dir, '.evidence', 'SUMMARY.json'), serialised)
    const orig = process.env['E2E_RISK_SKIP']
    process.env['E2E_RISK_SKIP'] = 'infra:#456:db-outage'
    try {
      const result = runVerifyEvidence({ dir })
      expect(result.skipped).toBe(true)
      expect(result.reason).toBe('infra:#456:db-outage')
    } finally {
      if (orig === undefined) {
        delete process.env['E2E_RISK_SKIP']
      } else {
        process.env['E2E_RISK_SKIP'] = orig
      }
    }
  })

  it('REFUSES unconstrained E2E_RISK_SKIP (falls through to normal verification)', () => {
    const { serialised } = makeSummary()
    writeFileSync(join(dir, '.evidence', 'SUMMARY.json'), serialised)
    const orig = process.env['E2E_RISK_SKIP']
    process.env['E2E_RISK_SKIP'] = 'lol'
    try {
      const result = runVerifyEvidence({ dir })
      // Verification ran normally — no skip honoured
      expect(result.skipped).toBeUndefined()
      // SUMMARY is valid → ok
      expect(result.exitCode).toBe(0)
      // Skip log was NOT written
      const skipLog = join(dir, '.evidence', 'skip-log.jsonl')
      expect(existsSync(skipLog)).toBe(false)
    } finally {
      if (orig === undefined) {
        delete process.env['E2E_RISK_SKIP']
      } else {
        process.env['E2E_RISK_SKIP'] = orig
      }
    }
  })

  it('REFUSES E2E_RISK_SKIP with unknown category (foo:#123)', () => {
    const { serialised } = makeSummary()
    writeFileSync(join(dir, '.evidence', 'SUMMARY.json'), serialised)
    const orig = process.env['E2E_RISK_SKIP']
    process.env['E2E_RISK_SKIP'] = 'foo:#123'
    try {
      const result = runVerifyEvidence({ dir })
      expect(result.skipped).toBeUndefined()
    } finally {
      if (orig === undefined) {
        delete process.env['E2E_RISK_SKIP']
      } else {
        process.env['E2E_RISK_SKIP'] = orig
      }
    }
  })

  it('rejects SUMMARY.json missing required schema fields (#241)', () => {
    // SHA is valid but required fields are absent
    const { serialised } = makeSummary({
      head_sha: undefined,
      obs_gate: undefined,
    })
    writeFileSync(join(dir, '.evidence', 'SUMMARY.json'), serialised)
    const result = runVerifyEvidence({ dir })
    expect(result.status).toBe('error')
    expect(result.exitCode).toBe(1)
    expect(result.reason).toMatch(/missing required field/)
  })

  // ── #1982: per-run-id evidence layout ────────────────────────────────────
  // Governed repos (e.g. viafera) write one SUMMARY.json per run under
  // `.evidence/<RUN_ID>/SUMMARY.json` (matches evidence-rotate.mjs.ejs's own
  // convention of run-id subdirectories directly under .evidence/), instead
  // of a single file at `.evidence/SUMMARY.json`. Today `runVerifyEvidence`
  // hardcodes the root-level path and reports "not found" even though a
  // valid, fresher summary exists in a run-id subdirectory.
  it('resolves SUMMARY.json from the most recent run-id subdirectory when no root file exists (#1982)', () => {
    const { serialised: older } = makeSummary({
      timestamp: new Date(Date.now() - 60_000).toISOString(),
    })
    const { serialised: newer } = makeSummary({
      timestamp: new Date().toISOString(),
    })
    mkdirSync(join(dir, '.evidence', 'run-20260101-000000'), { recursive: true })
    writeFileSync(join(dir, '.evidence', 'run-20260101-000000', 'SUMMARY.json'), older)
    mkdirSync(join(dir, '.evidence', 'run-20260717-120000'), { recursive: true })
    writeFileSync(join(dir, '.evidence', 'run-20260717-120000', 'SUMMARY.json'), newer)

    const result = runVerifyEvidence({ dir })
    expect(result.status).toBe('ok')
    expect(result.exitCode).toBe(0)
  })

  it('prefers the root-level .evidence/SUMMARY.json over any run-id subdirectory (back-compat)', () => {
    const { serialised: rootSummary } = makeSummary()
    writeFileSync(join(dir, '.evidence', 'SUMMARY.json'), rootSummary)

    // A run-id subdir with a broken summary must NOT be consulted — root wins.
    mkdirSync(join(dir, '.evidence', 'run-20260717-120000'), { recursive: true })
    writeFileSync(
      join(dir, '.evidence', 'run-20260717-120000', 'SUMMARY.json'),
      JSON.stringify({ broken: true }),
    )

    const result = runVerifyEvidence({ dir })
    expect(result.status).toBe('ok')
    expect(result.exitCode).toBe(0)
  })

  it('returns error when neither root nor any run-id subdirectory has SUMMARY.json', () => {
    mkdirSync(join(dir, '.evidence', 'run-20260717-120000'), { recursive: true })
    const result = runVerifyEvidence({ dir })
    expect(result.exitCode).toBe(1)
    expect(result.status).toBe('error')
    expect(result.reason).toMatch(/not found/)
  })
})
