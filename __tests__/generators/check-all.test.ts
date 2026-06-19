import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, readFileSync, writeFileSync, rmSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { generateCheckAll } from '../../src/generators/check-all.js'
import { makeConfig } from '../helpers.js'
import type { ProjectConfig } from '../../src/wizard/types.js'

describe('generateCheckAll', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'arbiter-check-all-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('generates scripts/check-all.mjs AND scripts/lib/run-helpers.mjs (#351, CANON-01)', () => {
    const result = generateCheckAll(makeConfig(dir))
    const paths = result.files.map((f) => f.path)
    expect(paths.some((p) => p.endsWith('scripts/check-all.mjs'))).toBe(true)
    expect(paths.some((p) => p.endsWith('scripts/lib/run-helpers.mjs'))).toBe(true)
    expect(result.files.every((f) => f.action === 'created')).toBe(true)
  })

  it('emits exactly 16 files at L1 (check-all + optional-emissions + run-helpers + collab-mode + constraint-scan + test-pyramid + api-e2e + render-smoke + glob-walk + conformance + no-tracked-artifacts + image-pins + e2e-reliability lib + e2e-quarantine + tdd-evidence + gold-audit)', () => {
    // L1: no docs-check; non-rust language: no Rust checkers → check-all + run-helpers
    // + check-collab-mode-wired (INV-100, #1093) + check-constraint-scan (INV-115, #1214)
    // + optional-emissions.json (INV-123, #1331) + check-test-pyramid.mjs (INV-124, #1364)
    // + check-api-e2e.mjs (INV-126, #1365)
    // + check-render-smoke.mjs + lib/glob-walk.mjs (INV-127, #1366)
    // + conformance.mjs (INV-128, #1398)
    // + check-no-tracked-artifacts.mjs (INV-129, #1407)
    // + check-image-pins.mjs (#1442)
    // + lib/e2e-reliability.mjs + check-e2e-quarantine.mjs (INV-130, #1445)
    // + check-tdd-evidence.mjs (INV-131, #1446)
    // + gold-audit.mjs (thin runner, #1419)
    const result = generateCheckAll(
      makeConfig(dir, { language: 'typescript', governanceLevel: 'L1' }),
    )
    expect(result.files).toHaveLength(16)
    expect(result.files.some((f) => f.path.endsWith('scripts/optional-emissions.json'))).toBe(true)
    expect(result.files.some((f) => f.path.endsWith('scripts/check-render-smoke.mjs'))).toBe(true)
    expect(result.files.some((f) => f.path.endsWith('scripts/lib/glob-walk.mjs'))).toBe(true)
    expect(result.files.some((f) => f.path.endsWith('scripts/conformance.mjs'))).toBe(true)
    expect(result.files.some((f) => f.path.endsWith('scripts/gold-audit.mjs'))).toBe(true)
    expect(
      result.files.some((f) => f.path.endsWith('scripts/check-no-tracked-artifacts.mjs')),
    ).toBe(true)
    expect(result.files.some((f) => f.path.endsWith('scripts/check-image-pins.mjs'))).toBe(true)
    expect(result.files.some((f) => f.path.endsWith('scripts/lib/e2e-reliability.mjs'))).toBe(true)
    expect(result.files.some((f) => f.path.endsWith('scripts/check-e2e-quarantine.mjs'))).toBe(true)
    expect(result.files.some((f) => f.path.endsWith('scripts/check-tdd-evidence.mjs'))).toBe(true)
  })

  it('emits scripts/check-api-e2e.mjs and wires it into check-all.mjs (#1365, INV-126)', () => {
    const result = generateCheckAll(makeConfig(dir, { language: 'typescript' }))
    const paths = result.files.map((f) => f.path)
    expect(paths.some((p) => p.endsWith('scripts/check-api-e2e.mjs'))).toBe(true)
    const script = readFileSync(join(dir, 'scripts', 'check-api-e2e.mjs'), 'utf-8')
    expect(script).toContain('INV-126')
    const checkAll = readFileSync(join(dir, 'scripts', 'check-all.mjs'), 'utf-8')
    expect(checkAll).toContain('check-api-e2e.mjs')
  })

  it('emits scripts/check-constraint-scan.mjs and wires it into check-all.mjs (#1214, INV-115)', () => {
    const result = generateCheckAll(makeConfig(dir, { language: 'typescript' }))
    const paths = result.files.map((f) => f.path)
    expect(paths.some((p) => p.endsWith('scripts/check-constraint-scan.mjs'))).toBe(true)
    const script = readFileSync(join(dir, 'scripts', 'check-constraint-scan.mjs'), 'utf-8')
    expect(script).toContain('INV-115')
    // Emitted twin defaults to warn (start-warn-promote-later) so a fresh init can't hard-fail.
    expect(script).toContain('const ENFORCE_DEFAULT = false')
    const checkAll = readFileSync(join(dir, 'scripts', 'check-all.mjs'), 'utf-8')
    expect(checkAll).toContain('check-constraint-scan.mjs')
  })

  it('emits scripts/check-collab-mode-wired.mjs and wires it into check-all.mjs (#1093, INV-100)', () => {
    const result = generateCheckAll(makeConfig(dir, { language: 'typescript' }))
    const paths = result.files.map((f) => f.path)
    expect(paths.some((p) => p.endsWith('scripts/check-collab-mode-wired.mjs'))).toBe(true)
    const script = readFileSync(join(dir, 'scripts', 'check-collab-mode-wired.mjs'), 'utf-8')
    expect(script).toContain('[INV-100]')
    expect(script).toContain('collaborationMode')
    const checkAll = readFileSync(join(dir, 'scripts', 'check-all.mjs'), 'utf-8')
    expect(checkAll).toContain('check-collab-mode-wired.mjs')
  })

  it('emits run-helpers.mjs with the trinity exports (#351)', () => {
    generateCheckAll(makeConfig(dir))
    const content = readFileSync(join(dir, 'scripts', 'lib', 'run-helpers.mjs'), 'utf-8')
    expect(content).toContain('export function runCheck')
    expect(content).toContain('export function runWarnCheck')
    expect(content).toContain('export function runToolCheck')
    expect(content).toContain('export function pushResult')
  })

  it('emits run-helpers.mjs with an explicit spawn maxBuffer + ENOBUFS-as-FAIL (buffer parity)', () => {
    generateCheckAll(makeConfig(dir))
    const content = readFileSync(join(dir, 'scripts', 'lib', 'run-helpers.mjs'), 'utf-8')
    // Generated projects inherit the same buffer guarantee as arbiter's own gate:
    // an explicit maxBuffer (not Node's 1 MB default) and ENOBUFS surfaced as an
    // actionable FAIL rather than a silent "exit null".
    expect(content).toContain('maxBuffer')
    expect(content).toContain("r.error.code === 'ENOBUFS'")
    expect(content).toContain('output exceeded buffer')
  })

  it('check-all.mjs contains inlined workflow-runners and ci-alignment logic', () => {
    generateCheckAll(makeConfig(dir))
    const content = readFileSync(join(dir, 'scripts', 'check-all.mjs'), 'utf-8')
    expect(content).toContain('CI_BUILD_RUNNER_LABEL')
    expect(content).toContain('_caDesignExemptions')
    expect(content).toContain('_caExtractManifestGates')
    expect(content).toContain('_wrViolations')
  })

  it('check-all.mjs has shebang line', () => {
    generateCheckAll(makeConfig(dir))
    const content = readFileSync(join(dir, 'scripts', 'check-all.mjs'), 'utf-8')
    expect(content).toMatch(/^#!/)
  })

  it('check-all.mjs contains lint and test commands for TypeScript', () => {
    generateCheckAll(makeConfig(dir, { language: 'typescript' }))
    const content = readFileSync(join(dir, 'scripts', 'check-all.mjs'), 'utf-8')
    expect(content).toContain('eslint')
    expect(content).toContain('npm')
    expect(content).toContain('prettier')
  })

  it('static analysis eslint uses --no-error-on-unmatched-pattern (avoids error on TypeScript-only src)', () => {
    generateCheckAll(makeConfig(dir, { language: 'typescript' }))
    const content = readFileSync(join(dir, 'scripts', 'check-all.mjs'), 'utf-8')
    expect(content).toContain('eslintrc-static.json')
    expect(content).toContain("'--no-error-on-unmatched-pattern'")
    expect(content).not.toContain("'--ext', '.ts,.js'")
  })

  it('check-all.mjs contains Rust commands for Rust projects', () => {
    generateCheckAll(makeConfig(dir, { language: 'rust', buildTool: 'cargo' }))
    const content = readFileSync(join(dir, 'scripts', 'check-all.mjs'), 'utf-8')
    expect(content).toContain('fmt')
    expect(content).toContain('clippy')
    expect(content).toContain('cargo')
  })

  it('skips if check-all.mjs already exists', () => {
    const scriptsDir = join(dir, 'scripts')
    mkdirSync(scriptsDir, { recursive: true })
    writeFileSync(join(scriptsDir, 'check-all.mjs'), 'EXISTING')

    const result = generateCheckAll(makeConfig(dir))
    const mainFile = result.files.find((f) => f.path.endsWith('scripts/check-all.mjs'))
    expect(mainFile?.action).toBe('skipped')
    expect(readFileSync(join(scriptsDir, 'check-all.mjs'), 'utf-8')).toBe('EXISTING')
  })

  it('includes debt ratchet gate at L2 when enableDebtGates is true', () => {
    generateCheckAll(makeConfig(dir, { enableDebtGates: true, governanceLevel: 'L2' }))
    const content = readFileSync(join(dir, 'scripts', 'check-all.mjs'), 'utf-8')
    expect(content).toContain('debt-report.mjs')
    expect(content).toContain('--gate')
  })

  it('uses --require-improvement flag at L3', () => {
    generateCheckAll(makeConfig(dir, { enableDebtGates: true, governanceLevel: 'L3' }))
    const content = readFileSync(join(dir, 'scripts', 'check-all.mjs'), 'utf-8')
    expect(content).toContain('--require-improvement')
  })

  it('does not include debt ratchet when enableDebtGates is false', () => {
    generateCheckAll(makeConfig(dir, { enableDebtGates: false }))
    const content = readFileSync(join(dir, 'scripts', 'check-all.mjs'), 'utf-8')
    expect(content).not.toContain('debt-report.mjs')
  })

  it('INCLUDES pitest for Java + Gradle at L2 (#347 — INV-30 wired)', () => {
    generateCheckAll(
      makeConfig(dir, {
        language: 'java',
        buildTool: 'gradle',
        enableDebtGates: true,
        governanceLevel: 'L2',
        enableMutationTesting: true,
        thresholdProfile: 'fixed',
      }),
    )
    const content = readFileSync(join(dir, 'scripts', 'check-all.mjs'), 'utf-8')
    expect(content).toContain("runCheck('mutation (pitest)', './gradlew', ['pitest', '-q']")
  })

  it('INCLUDES pitest for Java + Maven at L2 (#347 — INV-30 wired)', () => {
    generateCheckAll(
      makeConfig(dir, {
        language: 'java',
        buildTool: 'maven',
        enableDebtGates: true,
        governanceLevel: 'L2',
        enableMutationTesting: true,
        thresholdProfile: 'fixed',
      }),
    )
    const content = readFileSync(join(dir, 'scripts', 'check-all.mjs'), 'utf-8')
    expect(content).toContain(
      "runCheck('mutation (pitest)', 'mvn', ['org.pitest:pitest-maven:mutationCoverage', '-q']",
    )
  })

  it('does not include pitest for Java at L1 (no debt gates, mutation L2-only)', () => {
    generateCheckAll(
      makeConfig(dir, {
        language: 'java',
        buildTool: 'gradle',
        enableDebtGates: false,
        governanceLevel: 'L1',
      }),
    )
    const content = readFileSync(join(dir, 'scripts', 'check-all.mjs'), 'utf-8')
    expect(content).not.toContain("runCheck('mutation (pitest)'")
  })

  it('does not include pitest for non-Java languages at L2 (#347 — pitest is Java-only)', () => {
    for (const lang of ['typescript', 'rust', 'go', 'python'] as const) {
      generateCheckAll(
        makeConfig(dir, {
          language: lang,
          enableDebtGates: true,
          governanceLevel: 'L2',
          enableMutationTesting: true,
          thresholdProfile: 'fixed',
        }),
      )
      const content = readFileSync(join(dir, 'scripts', 'check-all.mjs'), 'utf-8')
      expect(content).not.toContain("runCheck('mutation (pitest)'")
    }
  })

  it('does not include mutation step when enableMutationTesting is false (#347)', () => {
    generateCheckAll(
      makeConfig(dir, {
        language: 'java',
        buildTool: 'gradle',
        enableDebtGates: true,
        governanceLevel: 'L2',
        enableMutationTesting: false,
        thresholdProfile: 'fixed',
      }),
    )
    const content = readFileSync(join(dir, 'scripts', 'check-all.mjs'), 'utf-8')
    expect(content).not.toContain("runCheck('mutation (pitest)'")
  })

  it('includes STRIDE/RACI traceability check at L2 when enableDebtGates is true', () => {
    generateCheckAll(makeConfig(dir, { enableDebtGates: true, governanceLevel: 'L2' }))
    const content = readFileSync(join(dir, 'scripts', 'check-all.mjs'), 'utf-8')
    expect(content).toContain('check-stride-traceability.mjs')
    expect(content).toContain('STRIDE')
  })

  it('does not include STRIDE check outside L2 block (appears only within if-level check)', () => {
    generateCheckAll(makeConfig(dir, { enableDebtGates: true }))
    const content = readFileSync(join(dir, 'scripts', 'check-all.mjs'), 'utf-8')
    // The check appears inside the `if (level === 'L2')` block — verify that
    const l2BlockStart = content.indexOf("if (level === 'L2')")
    const strideIdx = content.indexOf('check-stride-traceability.mjs')
    expect(l2BlockStart).toBeGreaterThan(-1)
    expect(strideIdx).toBeGreaterThan(l2BlockStart)
  })

  // ─── MG: scaled thresholds ──────────────────────────────────────────────────

  it('fixed profile (default) uses 80% coverage threshold at L2', () => {
    generateCheckAll(
      makeConfig(dir, {
        language: 'typescript',
        enableDebtGates: true,
        governanceLevel: 'L2',
        thresholdProfile: 'fixed',
        linesOfCode: 500,
      }),
    )
    const content = readFileSync(join(dir, 'scripts', 'check-all.mjs'), 'utf-8')
    expect(content).toContain('80')
    expect(content).toContain('coverage')
  })

  it('explicit zero lineCoverage is honored as-is, not substituted by computed default (#484)', () => {
    // #484: `||` would treat 0 as falsy and silently substitute the computed
    // default — that is the bug. With `??`, an explicit numeric 0 (which
    // schema-level validation rejects, so it can only arise from programmatic
    // ProjectConfig construction) is passed through verbatim. The point is
    // that the generator does NOT silently override what the caller asked for.
    generateCheckAll(
      makeConfig(dir, {
        language: 'typescript',
        enableDebtGates: true,
        governanceLevel: 'L2',
        thresholds: {
          lineCoverage: 0,
          branchCoverage: 70,
          mutationScore: 80,
          cyclomaticComplexity: 15,
          methodLength: 50,
          maxParams: 5,
        },
      }),
    )
    const content = readFileSync(join(dir, 'scripts', 'check-all.mjs'), 'utf-8')
    // The previously-substituted default (80) must NOT appear from a fallback.
    // Either the explicit 0 propagates, or the threshold is absent — but the
    // computed default of 80 must not be silently injected. The #1319.8 gate
    // embeds the threshold as `const _covThreshold = N;`.
    expect(content).not.toContain('_covThreshold = 80')
  })

  it('explicit zero mutationScore is honored as-is, not substituted by computed default (#484)', () => {
    generateCheckAll(
      makeConfig(dir, {
        language: 'typescript',
        enableDebtGates: true,
        governanceLevel: 'L3',
        thresholds: {
          lineCoverage: 80,
          branchCoverage: 70,
          mutationScore: 0,
          cyclomaticComplexity: 15,
          methodLength: 50,
          maxParams: 5,
        },
      }),
    )
    const content = readFileSync(join(dir, 'scripts', 'check-all.mjs'), 'utf-8')
    // L3 computed mutation default is 85; must not be silently substituted.
    expect(content).not.toContain('MUTATION_THRESHOLD=85')
  })

  it('non-zero lineCoverage is used as-is — no fallback triggered (#299 regression)', () => {
    generateCheckAll(
      makeConfig(dir, {
        language: 'typescript',
        enableDebtGates: true,
        governanceLevel: 'L2',
        thresholds: {
          lineCoverage: 75,
          branchCoverage: 70,
          mutationScore: 80,
          cyclomaticComplexity: 15,
          methodLength: 50,
          maxParams: 5,
        },
      }),
    )
    const content = readFileSync(join(dir, 'scripts', 'check-all.mjs'), 'utf-8')
    // #1319.8 gate embeds the threshold as `const _covThreshold = N;`.
    expect(content).toContain('_covThreshold = 75')
  })

  it('scaled profile + LoC<1000 omits coverage gate from generated script', () => {
    generateCheckAll(
      makeConfig(dir, {
        language: 'typescript',
        enableDebtGates: true,
        governanceLevel: 'L2',
        thresholdProfile: 'scaled',
        linesOfCode: 500,
      }),
    )
    const content = readFileSync(join(dir, 'scripts', 'check-all.mjs'), 'utf-8')
    // coverageEnabled=false at this LoC ⇒ the #1319.8 coverage gate is omitted.
    expect(content).not.toContain('coverage threshold (greenfield-aware')
    expect(content).not.toContain('_covThreshold')
  })

  it('scaled profile + LoC>=1000 includes coverage gate with ramped threshold', () => {
    generateCheckAll(
      makeConfig(dir, {
        language: 'typescript',
        enableDebtGates: true,
        governanceLevel: 'L2',
        thresholdProfile: 'scaled',
        linesOfCode: 5000,
      }),
    )
    const content = readFileSync(join(dir, 'scripts', 'check-all.mjs'), 'utf-8')
    expect(content).toContain('_covThreshold')
    // Threshold between 60% and 85% for 5k LoC
    expect(content).toMatch(/_covThreshold = \d{2}/)
  })

  it('scaled profile + LoC>=10000 uses 85% coverage threshold', () => {
    generateCheckAll(
      makeConfig(dir, {
        language: 'typescript',
        enableDebtGates: true,
        governanceLevel: 'L2',
        thresholdProfile: 'scaled',
        linesOfCode: 15_000,
      }),
    )
    const content = readFileSync(join(dir, 'scripts', 'check-all.mjs'), 'utf-8')
    expect(content).toContain('_covThreshold = 85')
  })

  // ─── MK: grace period guard ─────────────────────────────────────────────────

  it('runCheck treats ENOENT as hard failure regardless of grace period (lives in lib)', () => {
    generateCheckAll(makeConfig(dir))
    const content = readFileSync(join(dir, 'scripts', 'lib', 'run-helpers.mjs'), 'utf-8')
    expect(content).toContain('ENOENT')
    expect(content).toContain('command not found')
  })

  it('generated script includes grace guard block reading arbiter.json', () => {
    generateCheckAll(makeConfig(dir))
    const content = readFileSync(join(dir, 'scripts', 'check-all.mjs'), 'utf-8')
    expect(content).toContain('graceActive')
    expect(content).toContain('graceEndsAt')
    expect(content).toContain('graceFromLevel')
    expect(content).toContain('arbiter.json')
  })

  it('helper script implements WARN (grace period) path in runCheck (#351)', () => {
    generateCheckAll(makeConfig(dir))
    const content = readFileSync(join(dir, 'scripts', 'lib', 'run-helpers.mjs'), 'utf-8')
    // recordWarn emits "WARN (grace period, exit N, Tms)" via template literal —
    // assert both the helper structure (recordWarn called with grace-period msg)
    // and that the call lives in runCheck's soft branch.
    expect(content).toContain('grace period, exit ${r.status}')
    expect(content).toContain('recordWarn(name, elapsed,')
  })

  it('generated L2 audit call passes soft option', () => {
    generateCheckAll(makeConfig(dir, { language: 'typescript' }))
    const content = readFileSync(join(dir, 'scripts', 'check-all.mjs'), 'utf-8')
    expect(content).toContain('{ soft: graceActive }')
  })

  it('generated L2 debt ratchet call passes soft option', () => {
    generateCheckAll(makeConfig(dir, { enableDebtGates: true, governanceLevel: 'L2' }))
    const content = readFileSync(join(dir, 'scripts', 'check-all.mjs'), 'utf-8')
    const ratchetIdx = content.indexOf('debt-report.mjs')
    expect(ratchetIdx).toBeGreaterThan(-1)
    expect(content.slice(ratchetIdx)).toContain('graceActive')
  })

  // ─── M24: Security scanning ─────────────────────────────────────────────────

  it('PII scan runs before the L1 section (early-fail, not inside L2 block)', () => {
    generateCheckAll(
      makeConfig(dir, {
        enableSecurityScanning: true,
        governanceLevel: 'L2',
      }),
    )
    const content = readFileSync(join(dir, 'scripts', 'check-all.mjs'), 'utf-8')
    const piiIdx = content.indexOf('pii-scan.mjs')
    const l2BlockIdx = content.indexOf("if (level === 'L2')")
    expect(piiIdx).toBeGreaterThan(-1)
    expect(l2BlockIdx).toBeGreaterThan(-1)
    expect(piiIdx).toBeLessThan(l2BlockIdx)
  })

  it('PII scan is a hard fail (no soft: graceActive on pii-scan call)', () => {
    generateCheckAll(
      makeConfig(dir, {
        enableSecurityScanning: true,
        governanceLevel: 'L2',
      }),
    )
    const content = readFileSync(join(dir, 'scripts', 'check-all.mjs'), 'utf-8')
    const piiIdx = content.indexOf('pii-scan.mjs')
    expect(piiIdx).toBeGreaterThan(-1)
    // The runCheck call for pii-scan must not pass { soft: ... }
    const lineEnd = content.indexOf('\n', piiIdx)
    const piiLine = content.slice(content.lastIndexOf('\n', piiIdx) + 1, lineEnd)
    expect(piiLine).not.toContain('soft')
  })

  it('PII scan also runs at L1 (early-fail not inside L2 block)', () => {
    generateCheckAll(
      makeConfig(dir, {
        enableSecurityScanning: true,
        governanceLevel: 'L1',
      }),
    )
    const content = readFileSync(join(dir, 'scripts', 'check-all.mjs'), 'utf-8')
    expect(content).toContain('pii-scan.mjs')
  })

  it('gitleaks step present in L2 section when enableSecurityScanning is true', () => {
    generateCheckAll(
      makeConfig(dir, {
        enableSecurityScanning: true,
        governanceLevel: 'L2',
      }),
    )
    const content = readFileSync(join(dir, 'scripts', 'check-all.mjs'), 'utf-8')
    const l2BlockIdx = content.indexOf("if (level === 'L2')")
    const gitleaksIdx = content.indexOf('gitleaks', l2BlockIdx)
    expect(l2BlockIdx).toBeGreaterThan(-1)
    expect(gitleaksIdx).toBeGreaterThan(l2BlockIdx)
  })

  it('gitleaks step honors soft: graceActive (ADR-028)', () => {
    generateCheckAll(
      makeConfig(dir, {
        enableSecurityScanning: true,
        governanceLevel: 'L2',
      }),
    )
    const content = readFileSync(join(dir, 'scripts', 'check-all.mjs'), 'utf-8')
    const gitleaksIdx = content.indexOf('gitleaks')
    expect(gitleaksIdx).toBeGreaterThan(-1)
    const callEnd = content.indexOf('\n', gitleaksIdx)
    const callLine = content.slice(content.lastIndexOf('\n', gitleaksIdx) + 1, callEnd)
    expect(callLine).toContain('graceActive')
  })

  it('Java Gradle: dependencyCheckAnalyze in L2 when enableSecurityScanning', () => {
    generateCheckAll(
      makeConfig(dir, {
        language: 'java',
        buildTool: 'gradle',
        enableSecurityScanning: true,
        governanceLevel: 'L2',
      }),
    )
    const content = readFileSync(join(dir, 'scripts', 'check-all.mjs'), 'utf-8')
    const l2BlockIdx = content.indexOf("if (level === 'L2')")
    expect(content.indexOf('dependencyCheckAnalyze', l2BlockIdx)).toBeGreaterThan(l2BlockIdx)
  })

  it('Java Maven: dependency-check-maven in L2 when enableSecurityScanning', () => {
    generateCheckAll(
      makeConfig(dir, {
        language: 'java',
        buildTool: 'maven',
        enableSecurityScanning: true,
        governanceLevel: 'L2',
      }),
    )
    const content = readFileSync(join(dir, 'scripts', 'check-all.mjs'), 'utf-8')
    const l2BlockIdx = content.indexOf("if (level === 'L2')")
    expect(content.indexOf('dependency-check-maven', l2BlockIdx)).toBeGreaterThan(l2BlockIdx)
  })

  it('Go: govulncheck in L2 when enableSecurityScanning', () => {
    generateCheckAll(
      makeConfig(dir, {
        language: 'go',
        buildTool: 'go',
        enableSecurityScanning: true,
        governanceLevel: 'L2',
      }),
    )
    const content = readFileSync(join(dir, 'scripts', 'check-all.mjs'), 'utf-8')
    const l2BlockIdx = content.indexOf("if (level === 'L2')")
    expect(content.indexOf('govulncheck', l2BlockIdx)).toBeGreaterThan(l2BlockIdx)
  })

  it('Go: gofmt -l gate present in L1 block (#157)', () => {
    generateCheckAll(
      makeConfig(dir, {
        language: 'go',
        buildTool: 'go',
        governanceLevel: 'L1',
      }),
    )
    const content = readFileSync(join(dir, 'scripts', 'check-all.mjs'), 'utf-8')
    expect(content).toContain('gofmt')
    expect(content).toContain("'-l'")
  })

  it('frontend-spa TS: fsd boundaries gate present in check-all.mjs (#158)', () => {
    generateCheckAll(
      makeConfig(dir, {
        language: 'typescript',
        archetype: 'frontend-spa',
        governanceLevel: 'L1',
      }),
    )
    const content = readFileSync(join(dir, 'scripts', 'check-all.mjs'), 'utf-8')
    expect(content).toContain('fsd boundaries')
    expect(content).toContain('.eslintrc-frontend-spa.cjs')
  })

  it('enableSecurityScanning=false: no gitleaks, govulncheck, or OWASP DC step', () => {
    generateCheckAll(
      makeConfig(dir, {
        language: 'java',
        buildTool: 'gradle',
        enableSecurityScanning: false,
        governanceLevel: 'L2',
      }),
    )
    const content = readFileSync(join(dir, 'scripts', 'check-all.mjs'), 'utf-8')
    expect(content).not.toContain('gitleaks')
    expect(content).not.toContain('dependencyCheckAnalyze')
    expect(content).not.toContain('pii-scan.mjs')
  })

  it('enableSecurityScanning=false: typescript npm audit absent', () => {
    generateCheckAll(
      makeConfig(dir, {
        language: 'typescript',
        buildTool: 'npm',
        enableSecurityScanning: false,
        governanceLevel: 'L2',
      }),
    )
    const content = readFileSync(join(dir, 'scripts', 'check-all.mjs'), 'utf-8')
    expect(content).not.toContain('npm audit')
  })

  it('enableSecurityScanning=false: rust cargo audit absent', () => {
    generateCheckAll(
      makeConfig(dir, {
        language: 'rust',
        buildTool: 'cargo',
        enableSecurityScanning: false,
        governanceLevel: 'L2',
      }),
    )
    const content = readFileSync(join(dir, 'scripts', 'check-all.mjs'), 'utf-8')
    expect(content).not.toContain('cargo audit')
  })

  it('enableSecurityScanning=false: python pip-audit absent', () => {
    generateCheckAll(
      makeConfig(dir, {
        language: 'python',
        buildTool: 'pip',
        enableSecurityScanning: false,
        governanceLevel: 'L2',
      }),
    )
    const content = readFileSync(join(dir, 'scripts', 'check-all.mjs'), 'utf-8')
    expect(content).not.toContain('pip-audit')
  })

  it('gitleaks command uses --gitleaks-ignore-path not --baseline-path', () => {
    generateCheckAll(
      makeConfig(dir, {
        enableSecurityScanning: true,
        governanceLevel: 'L2',
      }),
    )
    const content = readFileSync(join(dir, 'scripts', 'check-all.mjs'), 'utf-8')
    expect(content).toContain('--gitleaks-ignore-path')
    expect(content).not.toContain('--baseline-path')
  })

  // ─── M26: hasDatabase integration test steps ────────────────────────────────

  describe('M26 hasDatabase integration steps', () => {
    // TypeScript
    it('TypeScript: includes vitest integration step at L2 when hasDatabase=true', () => {
      generateCheckAll(
        makeConfig(dir, {
          language: 'typescript',
          hasDatabase: true,
          governanceLevel: 'L2',
        }),
      )
      const content = readFileSync(join(dir, 'scripts', 'check-all.mjs'), 'utf-8')
      expect(content).toContain("'vitest', 'run', 'integration'")
    })

    it('TypeScript: omits vitest integration step at L2 when hasDatabase=false', () => {
      generateCheckAll(
        makeConfig(dir, {
          language: 'typescript',
          hasDatabase: false,
          governanceLevel: 'L2',
        }),
      )
      const content = readFileSync(join(dir, 'scripts', 'check-all.mjs'), 'utf-8')
      expect(content).not.toContain("'vitest', 'run', 'integration'")
    })

    it('TypeScript: omits vitest integration step at L1 even when hasDatabase=true', () => {
      generateCheckAll(
        makeConfig(dir, {
          language: 'typescript',
          hasDatabase: true,
          governanceLevel: 'L1',
        }),
      )
      const content = readFileSync(join(dir, 'scripts', 'check-all.mjs'), 'utf-8')
      expect(content).not.toContain("'vitest', 'run', 'integration'")
    })

    // Java Gradle
    it('Java Gradle: includes integrationTest step at L2 when hasDatabase=true', () => {
      generateCheckAll(
        makeConfig(dir, {
          language: 'java',
          buildTool: 'gradle',
          hasDatabase: true,
          governanceLevel: 'L2',
        }),
      )
      const content = readFileSync(join(dir, 'scripts', 'check-all.mjs'), 'utf-8')
      expect(content).toContain("'integrationTest'")
    })

    it('Java Gradle: omits integrationTest step at L2 when hasDatabase=false', () => {
      generateCheckAll(
        makeConfig(dir, {
          language: 'java',
          buildTool: 'gradle',
          hasDatabase: false,
          governanceLevel: 'L2',
        }),
      )
      const content = readFileSync(join(dir, 'scripts', 'check-all.mjs'), 'utf-8')
      expect(content).not.toContain("'integrationTest'")
    })

    it('Java Gradle: omits integrationTest step at L1 even when hasDatabase=true', () => {
      generateCheckAll(
        makeConfig(dir, {
          language: 'java',
          buildTool: 'gradle',
          hasDatabase: true,
          governanceLevel: 'L1',
        }),
      )
      const content = readFileSync(join(dir, 'scripts', 'check-all.mjs'), 'utf-8')
      expect(content).not.toContain("'integrationTest'")
    })

    // Java Maven
    it('Java Maven: includes mvn verify integration step at L2 when hasDatabase=true', () => {
      generateCheckAll(
        makeConfig(dir, {
          language: 'java',
          buildTool: 'maven',
          hasDatabase: true,
          governanceLevel: 'L2',
        }),
      )
      const content = readFileSync(join(dir, 'scripts', 'check-all.mjs'), 'utf-8')
      expect(content).toContain("['verify', '-q']")
    })

    it('Java Maven: omits mvn verify integration step at L2 when hasDatabase=false', () => {
      generateCheckAll(
        makeConfig(dir, {
          language: 'java',
          buildTool: 'maven',
          hasDatabase: false,
          governanceLevel: 'L2',
        }),
      )
      const content = readFileSync(join(dir, 'scripts', 'check-all.mjs'), 'utf-8')
      expect(content).not.toContain("['verify', '-q']")
    })

    it('Java Maven: omits mvn verify integration step at L1 even when hasDatabase=true', () => {
      generateCheckAll(
        makeConfig(dir, {
          language: 'java',
          buildTool: 'maven',
          hasDatabase: true,
          governanceLevel: 'L1',
        }),
      )
      const content = readFileSync(join(dir, 'scripts', 'check-all.mjs'), 'utf-8')
      expect(content).not.toContain("['verify', '-q']")
    })

    // Rust
    it('Rust: includes cargo test --tests step at L2 when hasDatabase=true', () => {
      generateCheckAll(
        makeConfig(dir, {
          language: 'rust',
          buildTool: 'cargo',
          hasDatabase: true,
          governanceLevel: 'L2',
        }),
      )
      const content = readFileSync(join(dir, 'scripts', 'check-all.mjs'), 'utf-8')
      expect(content).toContain("'--tests'")
      expect(content).not.toContain("'*integration*'")
    })

    it('Rust: omits cargo --tests step at L2 when hasDatabase=false', () => {
      generateCheckAll(
        makeConfig(dir, {
          language: 'rust',
          buildTool: 'cargo',
          hasDatabase: false,
          governanceLevel: 'L2',
        }),
      )
      const content = readFileSync(join(dir, 'scripts', 'check-all.mjs'), 'utf-8')
      expect(content).not.toContain("'--tests'")
    })

    it('Rust: omits cargo --tests step at L1 even when hasDatabase=true', () => {
      generateCheckAll(
        makeConfig(dir, {
          language: 'rust',
          buildTool: 'cargo',
          hasDatabase: true,
          governanceLevel: 'L1',
        }),
      )
      const content = readFileSync(join(dir, 'scripts', 'check-all.mjs'), 'utf-8')
      expect(content).not.toContain("'--tests'")
    })

    // Go
    it('Go: includes go test -tags integration step at L2 when hasDatabase=true', () => {
      generateCheckAll(
        makeConfig(dir, {
          language: 'go',
          buildTool: 'go',
          hasDatabase: true,
          governanceLevel: 'L2',
        }),
      )
      const content = readFileSync(join(dir, 'scripts', 'check-all.mjs'), 'utf-8')
      expect(content).toContain("'-tags', 'integration'")
    })

    it('Go: omits go test -tags integration step at L2 when hasDatabase=false', () => {
      generateCheckAll(
        makeConfig(dir, {
          language: 'go',
          buildTool: 'go',
          hasDatabase: false,
          governanceLevel: 'L2',
        }),
      )
      const content = readFileSync(join(dir, 'scripts', 'check-all.mjs'), 'utf-8')
      expect(content).not.toContain("'-tags', 'integration'")
    })

    it('Go: omits go test -tags integration step at L1 even when hasDatabase=true', () => {
      generateCheckAll(
        makeConfig(dir, {
          language: 'go',
          buildTool: 'go',
          hasDatabase: true,
          governanceLevel: 'L1',
        }),
      )
      const content = readFileSync(join(dir, 'scripts', 'check-all.mjs'), 'utf-8')
      expect(content).not.toContain("'-tags', 'integration'")
    })

    // Python
    it('Python: includes pytest tests/integration/ step at L2 when hasDatabase=true', () => {
      generateCheckAll(
        makeConfig(dir, {
          language: 'python',
          buildTool: 'pip',
          hasDatabase: true,
          governanceLevel: 'L2',
        }),
      )
      const content = readFileSync(join(dir, 'scripts', 'check-all.mjs'), 'utf-8')
      expect(content).toContain("'tests/integration/'")
    })

    it('Python: omits pytest tests/integration/ step at L2 when hasDatabase=false', () => {
      generateCheckAll(
        makeConfig(dir, {
          language: 'python',
          buildTool: 'pip',
          hasDatabase: false,
          governanceLevel: 'L2',
        }),
      )
      const content = readFileSync(join(dir, 'scripts', 'check-all.mjs'), 'utf-8')
      expect(content).not.toContain("'tests/integration/'")
    })

    it('Python: omits pytest tests/integration/ step at L1 even when hasDatabase=true', () => {
      generateCheckAll(
        makeConfig(dir, {
          language: 'python',
          buildTool: 'pip',
          hasDatabase: true,
          governanceLevel: 'L1',
        }),
      )
      const content = readFileSync(join(dir, 'scripts', 'check-all.mjs'), 'utf-8')
      expect(content).not.toContain("'tests/integration/'")
    })
  })

  // ── #1330: per-lane frontend gate (subtree lane, non-frontend-spa archetype) ──
  // The dead-FE-gate bug only manifests when the primary language is NOT typescript:
  // the L1/L2 _isFE blocks are TS-gated, so a Go-primary repo with a `frontend` lane
  // gets ZERO FE gating. These tests pin a Go-primary config to reproduce-red.
  describe('frontend lane gate (#1330)', () => {
    it('emits scripts/check-frontend-lane.mjs for a Go-primary subtree frontend lane', () => {
      const result = generateCheckAll(
        makeConfig(dir, { language: 'go', archetype: 'library', lanes: ['frontend'] }),
      )
      const paths = result.files.map((f) => f.path)
      expect(paths.some((p) => p.endsWith('scripts/check-frontend-lane.mjs'))).toBe(true)
    })

    it('wires runCheck for the frontend lane into check-all.mjs (Go-primary subtree)', () => {
      generateCheckAll(
        makeConfig(dir, { language: 'go', archetype: 'library', lanes: ['frontend'] }),
      )
      const checkAll = readFileSync(join(dir, 'scripts', 'check-all.mjs'), 'utf-8')
      expect(checkAll).toContain('check-frontend-lane.mjs')
    })

    it('does NOT emit check-frontend-lane.mjs for the frontend-spa archetype (root-level wiring already exists)', () => {
      const result = generateCheckAll(
        makeConfig(dir, {
          language: 'typescript',
          archetype: 'frontend-spa',
          lanes: ['frontend'],
        }),
      )
      const paths = result.files.map((f) => f.path)
      expect(paths.some((p) => p.endsWith('scripts/check-frontend-lane.mjs'))).toBe(false)
    })

    it('does NOT emit check-frontend-lane.mjs when no frontend lane is declared', () => {
      const result = generateCheckAll(
        makeConfig(dir, { language: 'go', archetype: 'library', lanes: ['docs'] }),
      )
      const paths = result.files.map((f) => f.path)
      expect(paths.some((p) => p.endsWith('scripts/check-frontend-lane.mjs'))).toBe(false)
    })

    it('does NOT emit check-frontend-lane.mjs when archetype is undefined (matches needsFrontendQuality convention)', () => {
      // Model a pre-classification config: archetype present-but-undefined (the key
      // stays on the object so template rendering sees it; the predicate must treat
      // an undefined archetype as "no subtree lane", mirroring needsFrontendQuality).
      const cfg: ProjectConfig = {
        ...makeConfig(dir, { language: 'go', lanes: ['frontend'] }),
        archetype: undefined as unknown as ProjectConfig['archetype'],
      }
      const result = generateCheckAll(cfg)
      const paths = result.files.map((f) => f.path)
      expect(paths.some((p) => p.endsWith('scripts/check-frontend-lane.mjs'))).toBe(false)
    })

    it('re-run over an existing file is a brownfield skip, not an overwrite (CANON-11, skipIfExists)', () => {
      const cfg = makeConfig(dir, {
        language: 'go',
        archetype: 'library',
        lanes: ['frontend'],
      })
      generateCheckAll(cfg)
      const second = generateCheckAll(cfg)
      const laneFile = second.files.find((f) => f.path.endsWith('scripts/check-frontend-lane.mjs'))
      expect(laneFile?.action).toBe('skipped')
    })

    it('emitted check-frontend-lane.mjs runs tsc/vitest in cwd:frontend and is gate-on-present', () => {
      generateCheckAll(
        makeConfig(dir, { language: 'go', archetype: 'library', lanes: ['frontend'] }),
      )
      const script = readFileSync(join(dir, 'scripts', 'check-frontend-lane.mjs'), 'utf-8')
      // gate-on-present: skip cleanly when the subtree or its deps are absent
      expect(script).toContain("existsSync('frontend/package.json')")
      expect(script).toContain("cwd: 'frontend'")
      // build runs only in full mode
      expect(script).toContain("mode === 'full'")
    })
  })

  describe('domain-api surface gate (#1367, INV-125)', () => {
    it('emits scripts/check-domain-api-surface.mjs and domain-api-surface.json when hasPublicApi=true', () => {
      const result = generateCheckAll(makeConfig(dir, { hasPublicApi: true }))
      const paths = result.files.map((f) => f.path)
      expect(paths.some((p) => p.endsWith('scripts/check-domain-api-surface.mjs'))).toBe(true)
      expect(paths.some((p) => p.endsWith('domain-api-surface.json'))).toBe(true)
    })

    it('does NOT emit domain-api surface files when hasPublicApi is false', () => {
      const result = generateCheckAll(makeConfig(dir, { hasPublicApi: false }))
      const paths = result.files.map((f) => f.path)
      expect(paths.some((p) => p.endsWith('scripts/check-domain-api-surface.mjs'))).toBe(false)
      expect(paths.some((p) => p.endsWith('domain-api-surface.json'))).toBe(false)
    })
  })
})
