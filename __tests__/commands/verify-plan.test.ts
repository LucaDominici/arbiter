import { mkdtempSync, readFileSync, rmSync, copyFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { describe, it, expect, afterEach } from 'vitest'
import { runVerifyPlan } from '../../src/commands/verify-plan.js'
import { ReviewStatus, type ReviewJsonV1, type PlanJsonV1 } from '../../src/types/plan.js'
import type { VerifyPlanRule } from '../../src/verify/rules/types.js'
import { uiLanguageRule } from '../../src/verify/rules/ui-language.js'
import { skipPatternsRule } from '../../src/verify/rules/skip-patterns.js'
import { orphanTodosRule } from '../../src/verify/rules/orphan-todos.js'
import { driveByScopeRule } from '../../src/verify/rules/drive-by-scope.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const FIXTURES_DIR = join(__dirname, '..', 'fixtures', 'bridge')

function setupFixture(variant: string): { tmpDir: string; planFile: string } {
  const tmpDir = mkdtempSync(join(tmpdir(), 'arbiter-verify-plan-'))
  const planFile = join(tmpDir, 'PLAN.json')
  copyFileSync(join(FIXTURES_DIR, variant, 'PLAN.json'), planFile)
  return { tmpDir, planFile }
}

function readReview(tmpDir: string): ReviewJsonV1 {
  const reviewPath = join(tmpDir, '.arbiter', 'plan', 'REVIEW.json')
  return JSON.parse(readFileSync(reviewPath, 'utf-8')) as ReviewJsonV1
}

const tmpDirs: string[] = []
afterEach(() => {
  for (const d of tmpDirs.splice(0)) {
    rmSync(d, { recursive: true, force: true })
  }
})

describe('runVerifyPlan', () => {
  it('skipped: review_bridge.enabled false → exitCode 0, status SKIPPED', () => {
    const { tmpDir, planFile } = setupFixture('skipped')
    tmpDirs.push(tmpDir)
    const result = runVerifyPlan({ file: planFile, dir: tmpDir })
    expect(result.exitCode).toBe(0)
    expect(ReviewStatus.options).toContain(result.status)
    expect(result.status).toBe('SKIPPED')
    const review = readReview(tmpDir)
    expect(review.status).toBe('SKIPPED')
    expect(review.verification.violations).toHaveLength(0)
  })

  it('approved: clean plan → exitCode 0, status APPROVED, run dir + pointer match', () => {
    const { tmpDir, planFile } = setupFixture('approved')
    tmpDirs.push(tmpDir)
    const result = runVerifyPlan({ file: planFile, dir: tmpDir })
    expect(result.exitCode).toBe(0)
    expect(result.status).toBe('APPROVED')
    expect(result.runId).toBeDefined()
    const pointer = readReview(tmpDir)
    const runDir = join(tmpDir, '.arbiter', 'plan', 'runs', result.runId!)
    const runReview = JSON.parse(readFileSync(join(runDir, 'REVIEW.json'), 'utf-8')) as ReviewJsonV1
    // pointer and run dir must have identical REVIEW.json content
    expect(pointer).toEqual(runReview)
    expect(pointer.status).toBe('APPROVED')
    // pointer and run dir must have identical PLAN.json content
    const pointerPlan = readFileSync(join(tmpDir, '.arbiter', 'plan', 'PLAN.json'), 'utf-8')
    const runPlan = readFileSync(join(runDir, 'PLAN.json'), 'utf-8')
    expect(pointerPlan).toBe(runPlan)
  })

  it('rejected: all 4 rules fire → exitCode 2, status REJECTED', () => {
    const { tmpDir, planFile } = setupFixture('rejected')
    tmpDirs.push(tmpDir)
    const result = runVerifyPlan({ file: planFile, dir: tmpDir })
    expect(result.exitCode).toBe(2)
    expect(result.status).toBe('REJECTED')
    const review = readReview(tmpDir)
    const ruleIds = new Set(review.verification.violations.map((v) => v.rule_id))
    expect(ruleIds.has('VB-INV-EN-UI')).toBe(true)
    expect(ruleIds.has('VB-INV-NO-SKIP')).toBe(true)
    expect(ruleIds.has('VB-INV-NO-ORPHAN')).toBe(true)
    expect(ruleIds.has('VB-INV-NO-DRIVEBY')).toBe(true)
  })

  it('error: malformed JSON → exitCode 2, status ERROR, rule_id SCHEMA', () => {
    const { tmpDir, planFile } = setupFixture('error-malformed')
    tmpDirs.push(tmpDir)
    const result = runVerifyPlan({ file: planFile, dir: tmpDir })
    expect(result.exitCode).toBe(2)
    expect(result.status).toBe('ERROR')
    const review = readReview(tmpDir)
    expect(review.verification.violations[0]?.rule_id).toBe('SCHEMA')
  })

  it('error: missing file → exitCode 2, status ERROR', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'arbiter-verify-plan-'))
    tmpDirs.push(tmpDir)
    const result = runVerifyPlan({
      file: join(tmpDir, 'nonexistent.json'),
      dir: tmpDir,
    })
    expect(result.exitCode).toBe(2)
    expect(result.status).toBe('ERROR')
  })

  it('fail_on_warn: WARN-only violations + fail_on_warn:true → REJECTED exit 2', () => {
    const { tmpDir, planFile } = setupFixture('approved')
    tmpDirs.push(tmpDir)
    const warnRule: VerifyPlanRule = {
      id: 'TEST-WARN',
      ssotPointer: { path: 'test', anchor: 'test' },
      applicability: () => true,
      evaluate: () => [
        {
          rule_id: 'TEST-WARN',
          severity: 'WARN',
          message: 'test warn',
          ssot_pointer: null,
          evidence: { paths: [] },
        },
      ],
    }
    const result = runVerifyPlan({
      file: planFile,
      dir: tmpDir,
      failOnWarn: true,
      extraRules: [warnRule],
    })
    expect(result.exitCode).toBe(2)
    expect(result.status).toBe('REJECTED')
  })

  it('RUN_ID uniqueness: two sequential runs produce different run dirs', () => {
    const { tmpDir, planFile } = setupFixture('approved')
    tmpDirs.push(tmpDir)
    const r1 = runVerifyPlan({ file: planFile, dir: tmpDir })
    const r2 = runVerifyPlan({ file: planFile, dir: tmpDir })
    expect(r1.runId).not.toBe(r2.runId)
  })

  it('plugin rule: extraRules injected → contributes violation', () => {
    const { tmpDir, planFile } = setupFixture('approved')
    tmpDirs.push(tmpDir)
    const errorRule: VerifyPlanRule = {
      id: 'PLUGIN-TEST',
      ssotPointer: { path: 'test', anchor: 'test' },
      applicability: () => true,
      evaluate: () => [
        {
          rule_id: 'PLUGIN-TEST',
          severity: 'ERROR',
          message: 'plugin test error',
          ssot_pointer: null,
          evidence: { paths: [] },
        },
      ],
    }
    const result = runVerifyPlan({
      file: planFile,
      dir: tmpDir,
      extraRules: [errorRule],
    })
    expect(result.exitCode).toBe(2)
    expect(result.status).toBe('REJECTED')
    const review = readReview(tmpDir)
    expect(review.verification.violations.some((v) => v.rule_id === 'PLUGIN-TEST')).toBe(true)
  })

  it('duplicate rule ID: extraRules shadow built-in → ERROR rule_id REGISTRY', () => {
    const { tmpDir, planFile } = setupFixture('approved')
    tmpDirs.push(tmpDir)
    const shadowRule: VerifyPlanRule = {
      id: 'VB-INV-EN-UI',
      ssotPointer: { path: 'test', anchor: 'test' },
      applicability: () => true,
      evaluate: () => [],
    }
    const result = runVerifyPlan({
      file: planFile,
      dir: tmpDir,
      extraRules: [shadowRule],
    })
    expect(result.exitCode).toBe(2)
    expect(result.status).toBe('ERROR')
    const review = readReview(tmpDir)
    expect(review.verification.violations[0]?.rule_id).toBe('REGISTRY')
  })

  it('rule-throws: evaluate exception → status ERROR, rule_id RUNTIME', () => {
    const { tmpDir, planFile } = setupFixture('approved')
    tmpDirs.push(tmpDir)
    const throwingRule: VerifyPlanRule = {
      id: 'THROW-TEST',
      ssotPointer: { path: 'test', anchor: 'test' },
      applicability: () => true,
      evaluate: () => {
        throw new Error('intentional test failure')
      },
    }
    const result = runVerifyPlan({
      file: planFile,
      dir: tmpDir,
      extraRules: [throwingRule],
    })
    expect(result.exitCode).toBe(2)
    expect(result.status).toBe('ERROR')
    const review = readReview(tmpDir)
    expect(review.verification.violations[0]?.rule_id).toBe('RUNTIME')
  })
})

const basePlan: PlanJsonV1 = {
  task_id: '#1',
  scope: { track: 'A' },
  files: [],
  review_bridge: { enabled: true, reviewer: 'test', fail_on_warn: false },
}

describe('VB-INV-EN-UI (ui-language rule)', () => {
  it("Italian word 'per' triggers violation", () => {
    const plan: PlanJsonV1 = {
      ...basePlan,
      files: [
        {
          path: 'src/foo.ts',
          operation: 'modify',
          changes: {
            adds_ui_strings: true,
            ui_strings: ['Clicca per continuare'],
          },
        },
      ],
    }
    const violations = uiLanguageRule.evaluate(plan, { targetDir: '' })
    expect(violations.length).toBeGreaterThan(0)
    expect(violations[0]?.rule_id).toBe('VB-INV-EN-UI')
  })

  it("'perché' does not trigger word-boundary false positive", () => {
    const plan: PlanJsonV1 = {
      ...basePlan,
      files: [
        {
          path: 'src/foo.ts',
          operation: 'modify',
          changes: {
            adds_ui_strings: true,
            ui_strings: ['perché'],
          },
        },
      ],
    }
    const violations = uiLanguageRule.evaluate(plan, { targetDir: '' })
    expect(violations).toHaveLength(0)
  })
})

describe('VB-INV-NO-SKIP (skip-patterns rule)', () => {
  const mkSkipPlan = (skipPatterns: string[]): PlanJsonV1 => ({
    ...basePlan,
    files: [
      {
        path: 'src/foo.test.ts',
        operation: 'modify',
        changes: { adds_tests: true, skip_patterns: skipPatterns },
      },
    ],
  })

  it.each(['@Disabled', '.skip(', '@Ignore', 'xit(', 'xdescribe(', 'it.skip'])(
    "pattern '%s' triggers violation",
    (pattern) => {
      const violations = skipPatternsRule.evaluate(mkSkipPlan([pattern]), {
        targetDir: '',
      })
      expect(violations.length).toBeGreaterThan(0)
      expect(violations[0]?.rule_id).toBe('VB-INV-NO-SKIP')
    },
  )

  it('applicability: file with skip_patterns but no adds_tests still applies', () => {
    const plan: PlanJsonV1 = {
      ...basePlan,
      files: [
        {
          path: 'src/foo.ts',
          operation: 'modify',
          changes: { skip_patterns: ['@Disabled'] },
        },
      ],
    }
    expect(skipPatternsRule.applicability(plan)).toBe(true)
  })
})

describe('VB-INV-NO-ORPHAN (orphan-todos rule)', () => {
  it('TODO with #NNN ref is valid', () => {
    const plan: PlanJsonV1 = {
      ...basePlan,
      files: [
        {
          path: 'src/foo.ts',
          operation: 'modify',
          changes: { adds_todos: ['TODO(#123): fix this'] },
        },
      ],
    }
    expect(orphanTodosRule.evaluate(plan, { targetDir: '' })).toHaveLength(0)
  })

  it('TODO with T-AAA-123 ref is valid', () => {
    const plan: PlanJsonV1 = {
      ...basePlan,
      files: [
        {
          path: 'src/foo.ts',
          operation: 'modify',
          changes: { adds_todos: ['TODO(T-FOO-42): fix this'] },
        },
      ],
    }
    expect(orphanTodosRule.evaluate(plan, { targetDir: '' })).toHaveLength(0)
  })

  it('bare TODO without ref triggers violation', () => {
    const plan: PlanJsonV1 = {
      ...basePlan,
      files: [
        {
          path: 'src/foo.ts',
          operation: 'modify',
          changes: { adds_todos: ['TODO: no task ref'] },
        },
      ],
    }
    const violations = orphanTodosRule.evaluate(plan, { targetDir: '' })
    expect(violations.length).toBeGreaterThan(0)
    expect(violations[0]?.rule_id).toBe('VB-INV-NO-ORPHAN')
  })
})

describe('VB-INV-NO-DRIVEBY (drive-by-scope rule)', () => {
  it('paths[] boundary: file outside declared paths triggers ERROR', () => {
    const plan: PlanJsonV1 = {
      ...basePlan,
      scope: { track: 'A', paths: ['src/'] },
      files: [
        { path: 'src/foo.ts', operation: 'modify' },
        { path: 'docs/README.md', operation: 'modify' },
      ],
    }
    const violations = driveByScopeRule.evaluate(plan, { targetDir: '' })
    expect(violations.some((v) => v.severity === 'ERROR')).toBe(true)
  })

  it('paths[] boundary: prefix false positive prevented (src-other not in src/)', () => {
    const plan: PlanJsonV1 = {
      ...basePlan,
      scope: { track: 'A', paths: ['src/'] },
      files: [{ path: 'src-other/foo.ts', operation: 'modify' }],
    }
    const violations = driveByScopeRule.evaluate(plan, { targetDir: '' })
    expect(violations.some((v) => v.severity === 'ERROR')).toBe(true)
  })

  it('boundaries[] branch: file outside declared segment triggers ERROR', () => {
    const plan: PlanJsonV1 = {
      ...basePlan,
      scope: { track: 'A', boundaries: ['src'] },
      files: [
        { path: 'src/foo.ts', operation: 'modify' },
        { path: 'docs/README.md', operation: 'modify' },
      ],
    }
    const violations = driveByScopeRule.evaluate(plan, { targetDir: '' })
    expect(violations.some((v) => v.rule_id === 'VB-INV-NO-DRIVEBY')).toBe(true)
  })

  it('heuristic: 1 top-level segment → no violation', () => {
    const plan: PlanJsonV1 = {
      ...basePlan,
      files: [
        { path: 'src/a.ts', operation: 'modify' },
        { path: 'src/b.ts', operation: 'modify' },
      ],
    }
    expect(driveByScopeRule.evaluate(plan, { targetDir: '' })).toHaveLength(0)
  })

  it('heuristic: 2 top-level segments → WARN', () => {
    const plan: PlanJsonV1 = {
      ...basePlan,
      files: [
        { path: 'src/a.ts', operation: 'modify' },
        { path: 'docs/b.md', operation: 'modify' },
      ],
    }
    const violations = driveByScopeRule.evaluate(plan, { targetDir: '' })
    expect(violations.some((v) => v.severity === 'WARN')).toBe(true)
    expect(violations.every((v) => v.severity !== 'ERROR')).toBe(true)
  })

  it('heuristic: >2 top-level segments → ERROR', () => {
    const plan: PlanJsonV1 = {
      ...basePlan,
      files: [
        { path: 'src/a.ts', operation: 'modify' },
        { path: 'docs/b.md', operation: 'modify' },
        { path: 'scripts/c.sh', operation: 'modify' },
      ],
    }
    const violations = driveByScopeRule.evaluate(plan, { targetDir: '' })
    expect(violations.some((v) => v.severity === 'ERROR')).toBe(true)
  })
})
