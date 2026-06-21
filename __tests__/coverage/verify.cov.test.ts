// SPDX-License-Identifier: Apache-2.0
//
// Branch-coverage climb for src/commands/verify.ts (#1486) — the branches the
// existing __tests__/commands/verify-evidence.test.ts leaves uncovered:
//
//   runVerify (the probe-driven CLI path):
//     - opts.json truthy  → formatJson(enriched) + loadConfig branch
//     - opts.json falsy   → formatText branch
//     - report.hasFailures true  → process.exit(1)
//     - report.hasFailures false → no exit
//     - opts.dir ?? '.'   → both the provided-dir and default-'.' sides
//   runVerifyEvidence edge branches:
//     - handleRiskSkip: whitespace-only E2E_RISK_SKIP → null (proceed)
//     - writeSkipEntry catch path: append/mkdir failure re-throws (err with a
//       `code` property AND err without one → "unknown")
//     - loadSummary: invalid JSON → LoadFailure envelope (exit 1)
//     - resolveStack: stored stack is a non-known string → detectLanguage fallback
//     - classifyFiles: non-string entries skipped; all-non-string → null (no riskLevel)
//     - checkFreshness: missing timestamp / non-string ts / non-finite ts → null (fresh)
//
// runProbes / formatText / formatJson / loadConfig are module-mocked because they
// shell out / read project config; the evidence path runs against a real temp
// fixture. process.exit is stubbed to THROW a sentinel so the runner is never killed.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { VerifyReport } from '../../src/compatibility/schema.js'

// --- module mocks (only the probe-path dependencies that shell out) ----------
vi.mock('../../src/compatibility/probe.js', () => ({
  runProbes: vi.fn(),
}))
vi.mock('../../src/compatibility/report.js', () => ({
  formatText: vi.fn(() => 'TEXT_REPORT'),
  formatJson: vi.fn(() => 'JSON_REPORT'),
}))
vi.mock('../../src/utils/config.js', () => ({
  loadConfig: vi.fn(() => ({ governanceLevel: 'standard' })),
}))

import { runProbes } from '../../src/compatibility/probe.js'
import { formatText, formatJson } from '../../src/compatibility/report.js'
import { loadConfig } from '../../src/utils/config.js'
import { computeSummarySha } from '../../src/risk/sha-check.js'
import { runVerify, runVerifyEvidence } from '../../src/commands/verify.js'

const mockRunProbes = vi.mocked(runProbes)
const mockFormatText = vi.mocked(formatText)
const mockFormatJson = vi.mocked(formatJson)
const mockLoadConfig = vi.mocked(loadConfig)

// ---- typed factory: satisfy the FULL VerifyReport shape ----------------------
function report(overrides: Partial<VerifyReport> = {}): VerifyReport {
  return {
    dir: '/tmp/x',
    stack: 'typescript',
    probes: [],
    hasFailures: false,
    hasWarnings: false,
    ...overrides,
  }
}

// ---- summary fixture builder (mirrors verify-evidence.test.ts) ---------------
function writeSummary(dir: string, body: Record<string, unknown>): void {
  const sha = computeSummarySha(body)
  writeFileSync(
    join(dir, '.evidence', 'SUMMARY.json'),
    JSON.stringify({ ...body, sha }, null, 2),
    'utf-8',
  )
}

function validBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    stack: 'typescript',
    files: ['src/api/users.ts'],
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
}

describe('runVerify (probe-driven CLI path)', () => {
  let writeSpy: ReturnType<typeof vi.spyOn>
  let exitSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.clearAllMocks()
    mockFormatText.mockReturnValue('TEXT_REPORT')
    mockFormatJson.mockReturnValue('JSON_REPORT')
    mockLoadConfig.mockReturnValue({ governanceLevel: 'standard' } as unknown as ReturnType<
      typeof loadConfig
    >)
    writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation((): boolean => true)
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number): never => {
      throw new Error(`process.exit(${code ?? 0})`)
    }) as (code?: number) => never)
  })

  afterEach(() => {
    writeSpy.mockRestore()
    exitSpy.mockRestore()
  })

  it('text path: no json, no failures → formatText, no exit', () => {
    mockRunProbes.mockReturnValue(report({ hasFailures: false }))
    runVerify({ dir: '/some/dir' })
    expect(mockRunProbes).toHaveBeenCalledOnce()
    expect(mockFormatText).toHaveBeenCalledOnce()
    expect(mockFormatJson).not.toHaveBeenCalled()
    expect(mockLoadConfig).not.toHaveBeenCalled()
    expect(writeSpy).toHaveBeenCalledWith('TEXT_REPORT\n')
    expect(exitSpy).not.toHaveBeenCalled()
  })

  it('json path: json=true → loadConfig + formatJson(enriched)', () => {
    mockRunProbes.mockReturnValue(report({ hasFailures: false }))
    runVerify({ dir: '/some/dir', json: true })
    expect(mockLoadConfig).toHaveBeenCalledOnce()
    expect(mockFormatJson).toHaveBeenCalledOnce()
    expect(mockFormatText).not.toHaveBeenCalled()
    // the enriched envelope carries effectiveConfig spread over the report
    const arg = mockFormatJson.mock.calls[0]?.[0] as Record<string, unknown>
    expect(arg['effectiveConfig']).toEqual({ governanceLevel: 'standard' })
    expect(arg['stack']).toBe('typescript')
    expect(writeSpy).toHaveBeenCalledWith('JSON_REPORT\n')
    expect(exitSpy).not.toHaveBeenCalled()
  })

  it('failure path: hasFailures true → process.exit(1)', () => {
    mockRunProbes.mockReturnValue(report({ hasFailures: true }))
    expect(() => runVerify({ dir: '/some/dir' })).toThrow('process.exit(1)')
    expect(exitSpy).toHaveBeenCalledWith(1)
  })

  it("default dir: opts.dir absent → resolves '.' and still probes", () => {
    mockRunProbes.mockReturnValue(report({ hasFailures: false }))
    runVerify({})
    expect(mockRunProbes).toHaveBeenCalledOnce()
    // dir passed to runProbes is the resolved cwd (absolute path)
    const dirArg = mockRunProbes.mock.calls[0]?.[0] as string
    expect(dirArg.startsWith('/')).toBe(true)
  })
})

describe('runVerifyEvidence edge branches', () => {
  let dir: string
  let stderrSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'arbiter-verify-cov-'))
    mkdirSync(join(dir, '.evidence'), { recursive: true })
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation((): boolean => true)
  })

  afterEach(() => {
    stderrSpy.mockRestore()
    rmSync(dir, { recursive: true, force: true })
    delete process.env['E2E_RISK_SKIP']
  })

  it('whitespace-only E2E_RISK_SKIP → proceeds to normal verification', () => {
    writeSummary(dir, validBody())
    process.env['E2E_RISK_SKIP'] = '   '
    const result = runVerifyEvidence({ dir })
    // No skip honoured; valid summary → ok
    expect(result.skipped).toBeUndefined()
    expect(result.exitCode).toBe(0)
  })

  it('writeSkipEntry failure re-throws (mkdir over a file path → errno surfaced)', () => {
    writeSummary(dir, validBody())
    // Make `.evidence` itself a FILE so mkdirSync(join(dir,'.evidence'),...)
    // and the subsequent append fail with a filesystem errno.
    rmSync(join(dir, '.evidence'), { recursive: true, force: true })
    writeFileSync(join(dir, '.evidence'), 'not-a-dir', 'utf-8')
    process.env['E2E_RISK_SKIP'] = 'flake:#999'
    expect(() => runVerifyEvidence({ dir })).toThrow()
    // The refusal message was surfaced to stderr with an errno marker.
    const calls = stderrSpy.mock.calls.map((c: unknown[]) => String(c[0]))
    expect(calls.some((m: string) => m.includes('refusing to honour E2E_RISK_SKIP'))).toBe(true)
  })

  it('invalid JSON SUMMARY.json → error envelope exit 1', () => {
    writeFileSync(join(dir, '.evidence', 'SUMMARY.json'), '{ this is : not json', 'utf-8')
    const result = runVerifyEvidence({ dir })
    expect(result.status).toBe('error')
    expect(result.exitCode).toBe(1)
    expect(result.reason).toMatch(/invalid JSON/)
  })

  it('non-known stored stack → falls back to detectLanguage(dir)', () => {
    // stack:'cobol' is not in KNOWN_STACKS → resolveStack uses detectLanguage,
    // which on an empty temp dir yields 'unknown'. A .ts file then classifies
    // R-unknown (UNCLASSIFIED) → advisory exit 1 with manual-review reason.
    writeSummary(dir, validBody({ stack: 'cobol', files: ['src/api/users.ts'] }))
    const result = runVerifyEvidence({ dir })
    expect(result.exitCode).toBe(1)
    expect(result.reason).toMatch(/manual review/)
  })

  it('files[] with only non-string entries → no risk gating (riskLevel absent)', () => {
    // Non-string entries are skipped → levels empty → classifyFiles returns null.
    writeSummary(dir, validBody({ files: [42, true, null] }))
    const result = runVerifyEvidence({ dir })
    expect(result.exitCode).toBe(0)
    expect(result.riskLevel).toBeUndefined()
  })

  it('files[] mixing one valid string with junk → classifies the string only', () => {
    // src/api/users.ts → R2; the junk entries are skipped, not classified.
    writeSummary(dir, validBody({ files: [123, 'src/api/users.ts', {}] }))
    const result = runVerifyEvidence({ dir })
    expect(result.exitCode).toBe(0)
    expect(result.riskLevel).toBe('R2')
  })

  it('missing timestamp → freshness check returns null (treated fresh)', () => {
    writeSummary(dir, validBody({ timestamp: undefined }))
    const result = runVerifyEvidence({ dir })
    expect(result.exitCode).toBe(0)
    expect(result.status).toBe('ok')
  })

  it('non-string timestamp → freshness check returns null (treated fresh)', () => {
    writeSummary(dir, validBody({ timestamp: 1234567890 }))
    const result = runVerifyEvidence({ dir })
    expect(result.exitCode).toBe(0)
    expect(result.status).toBe('ok')
  })

  it('unparseable timestamp string → freshness check returns null (treated fresh)', () => {
    writeSummary(dir, validBody({ timestamp: 'not-a-date' }))
    const result = runVerifyEvidence({ dir })
    expect(result.exitCode).toBe(0)
    expect(result.status).toBe('ok')
  })
})
