// SPDX-License-Identifier: Apache-2.0
/**
 * #1329 — agent-agnostic plan review.
 *
 * Verifies the `--emit-prompts` → review → `submit` loop produces evidence
 * byte-compatible with the claude-dispatch path, so the unchanged plan-review
 * gate (`requirePlanReviewPass`) finalises identically regardless of which
 * agent (a hosted session, Codex, Claude Code) served as reviewer.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createHash } from 'node:crypto'
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  dispatchPlanReview,
  emitPlanReviewPrompts,
  isVerdict,
  submitPlanReview,
  SubmitValidationError,
  type EmitManifest,
  type SubagentResult,
  type SubagentDispatcher,
} from '../../src/review/dispatch.js'
import { runReviewPlan, runReviewSubmit } from '../../src/commands/review.js'

const PLAN = `# Plan: agent-agnostic
## Scope
- src/review/dispatch.ts
## Test plan
- write failing tests first
`

function withTempDir(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'arbiter-1329-'))
  writeFileSync(join(dir, 'AGENTS.md'), '# Test AGENTS.md\n')
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

function fakeDispatcher(verdict: string): SubagentDispatcher {
  return { run: (): SubagentResult => ({ stdout: `verdict: ${verdict}\n`, exitCode: 0 }) }
}

/** Re-implements the gate's latest.json PASS check (src/commands/task.ts). */
function gatePasses(dir: string, taskId: string, planContent: string): boolean {
  const sanit = taskId.replace(/[^A-Za-z0-9._-]/g, '_')
  const latestPath = join(dir, '.arbiter', 'evidence', 'plan-review', sanit, 'latest.json')
  if (!existsSync(latestPath)) return false
  const parsed = JSON.parse(readFileSync(latestPath, 'utf-8')) as {
    verdict: string
    planDigest?: string
  }
  if (parsed.verdict !== 'PASS') return false
  if (parsed.planDigest !== undefined) {
    const got = createHash('sha256').update(planContent).digest('hex')
    if (got !== parsed.planDigest) return false
  }
  return true
}

describe('emitPlanReviewPrompts (#1329)', () => {
  let env: ReturnType<typeof withTempDir>
  beforeEach(() => (env = withTempDir()))
  afterEach(() => env.cleanup())

  it('writes one prompt per tier pass + a manifest, without dispatching claude', () => {
    const emitDir = join(env.dir, 'emit')
    const res = emitPlanReviewPrompts({
      planContent: PLAN,
      dir: env.dir,
      tier: 'S',
      emitDir,
      taskId: '#1329',
    })
    expect(res.passCount).toBe(3)
    expect(res.promptPaths).toHaveLength(3)
    for (const p of res.promptPaths) {
      const body = readFileSync(p, 'utf-8')
      expect(body).toContain('<review')
      expect(body).toContain('## Scope')
    }
    const manifest = JSON.parse(readFileSync(res.manifestPath, 'utf-8')) as EmitManifest
    expect(manifest.passCount).toBe(3)
    expect(manifest.tier).toBe('S')
    expect(manifest.planDigest).toBe(createHash('sha256').update(PLAN).digest('hex'))
    // No latest.json — the review has not been performed yet.
    expect(
      existsSync(join(env.dir, '.arbiter', 'evidence', 'plan-review', '_1329', 'latest.json')),
    ).toBe(false)
  })

  it('runReviewPlan({emitPrompts}) exits 0 and writes no latest.json', () => {
    const planFile = join(env.dir, 'plan.md')
    writeFileSync(planFile, PLAN, 'utf-8')
    const emitDir = join(env.dir, 'emit')
    const result = runReviewPlan({
      file: planFile,
      dir: env.dir,
      tier: 'XS',
      emitPrompts: emitDir,
    })
    expect(result.exitCode).toBe(0)
    expect(existsSync(join(emitDir, 'pass-1.txt'))).toBe(true)
    expect(existsSync(join(emitDir, 'manifest.json'))).toBe(true)
  })
})

describe('submitPlanReview (#1329)', () => {
  let env: ReturnType<typeof withTempDir>
  beforeEach(() => (env = withTempDir()))
  afterEach(() => env.cleanup())

  it('all-PASS verdicts → PASS latest.json that unblocks the gate', () => {
    const res = submitPlanReview({
      dir: env.dir,
      tier: 'S',
      planContent: PLAN,
      reviewer: 'agent-harness',
      taskId: '#1329',
      passes: [
        { pass: 1, verdict: 'PASS' },
        { pass: 2, verdict: 'PASS' },
        { pass: 3, verdict: 'PASS' },
      ],
    })
    expect(res.verdict).toBe('PASS')
    expect(res.exitCode).toBe(0)
    const latest = JSON.parse(readFileSync(res.latestPath, 'utf-8')) as Record<string, unknown>
    expect(latest.verdict).toBe('PASS')
    expect(latest.source).toBe('submit')
    expect(latest.reviewer).toBe('agent-harness')
    expect(typeof latest.planDigest).toBe('string')
    expect(gatePasses(env.dir, '#1329', PLAN)).toBe(true)
  })

  it('a FAIL pass → final FAIL, exit 2, gate stays blocked', () => {
    const res = submitPlanReview({
      dir: env.dir,
      tier: 'S',
      planContent: PLAN,
      reviewer: 'codex',
      taskId: '#1329',
      passes: [
        { pass: 1, verdict: 'PASS' },
        { pass: 2, verdict: 'FAIL' },
        { pass: 3, verdict: 'PASS' },
      ],
    })
    expect(res.verdict).toBe('FAIL')
    expect(res.exitCode).toBe(2)
    expect(gatePasses(env.dir, '#1329', PLAN)).toBe(false)
  })

  it('rejects wrong pass count, duplicate, out-of-range, bad verdict (no evidence written)', () => {
    const base = {
      dir: env.dir,
      tier: 'S' as const,
      planContent: PLAN,
      reviewer: 'r',
      taskId: '#1329',
    }
    expect(() => submitPlanReview({ ...base, passes: [{ pass: 1, verdict: 'PASS' }] })).toThrow(
      SubmitValidationError,
    )
    expect(() =>
      submitPlanReview({
        ...base,
        passes: [
          { pass: 1, verdict: 'PASS' },
          { pass: 1, verdict: 'PASS' },
          { pass: 1, verdict: 'PASS' },
        ],
      }),
    ).toThrow(/duplicate/)
    expect(() =>
      submitPlanReview({
        ...base,
        passes: [
          { pass: 1, verdict: 'PASS' },
          { pass: 2, verdict: 'PASS' },
          { pass: 9, verdict: 'PASS' },
        ],
      }),
    ).toThrow(/out of range/)
    // No latest.json was written by any failed call.
    expect(
      existsSync(join(env.dir, '.arbiter', 'evidence', 'plan-review', '_1329', 'latest.json')),
    ).toBe(false)
  })

  it('cross-checks the emit manifest and rejects a changed plan', () => {
    const emitDir = join(env.dir, 'emit')
    const emit = emitPlanReviewPrompts({
      planContent: PLAN,
      dir: env.dir,
      tier: 'XS',
      emitDir,
      taskId: '#1329',
    })
    // Same plan → accepted.
    const ok = submitPlanReview({
      dir: env.dir,
      tier: 'XS',
      planContent: PLAN,
      reviewer: 'r',
      taskId: '#1329',
      passes: [{ pass: 1, verdict: 'PASS' }],
      manifestPath: emit.manifestPath,
    })
    expect(ok.verdict).toBe('PASS')
    // Changed plan → rejected against the manifest digest.
    expect(() =>
      submitPlanReview({
        dir: env.dir,
        tier: 'XS',
        planContent: PLAN + '\n## Extra\n',
        reviewer: 'r',
        taskId: '#1329',
        passes: [{ pass: 1, verdict: 'PASS' }],
        manifestPath: emit.manifestPath,
      }),
    ).toThrow(/plan changed/)
  })

  it('manifest cross-check rejects a tier mismatch and an SSOT change (RT-#1329 hardening)', () => {
    const emitDir = join(env.dir, 'emit')
    const emit = emitPlanReviewPrompts({
      planContent: PLAN,
      dir: env.dir,
      tier: 'XS',
      emitDir,
      taskId: '#1329',
    })
    // Tier mismatch: emitted at XS, submitted as S → rejected (S also needs 3 passes,
    // but the tier guard fires first regardless of pass count).
    expect(() =>
      submitPlanReview({
        dir: env.dir,
        tier: 'S',
        planContent: PLAN,
        reviewer: 'r',
        taskId: '#1329',
        passes: [
          { pass: 1, verdict: 'PASS' },
          { pass: 2, verdict: 'PASS' },
          { pass: 3, verdict: 'PASS' },
        ],
        manifestPath: emit.manifestPath,
      }),
    ).toThrow(/tier/)
    // SSOT change: AGENTS.md edited after emit → stale prompts → rejected.
    writeFileSync(join(env.dir, 'AGENTS.md'), '# Changed governance\n')
    expect(() =>
      submitPlanReview({
        dir: env.dir,
        tier: 'XS',
        planContent: PLAN,
        reviewer: 'r',
        taskId: '#1329',
        passes: [{ pass: 1, verdict: 'PASS' }],
        manifestPath: emit.manifestPath,
      }),
    ).toThrow(/SSOT/)
  })

  it('isVerdict guards the public submit boundary against bogus tokens', () => {
    expect(isVerdict('PASS')).toBe(true)
    expect(isVerdict('BOGUS')).toBe(false)
    expect(isVerdict(42)).toBe(false)
    // A programmatic caller `as`-casting a bogus token is rejected, not folded to WARN.
    expect(() =>
      submitPlanReview({
        dir: env.dir,
        tier: 'XS',
        planContent: PLAN,
        reviewer: 'r',
        taskId: '#1329',
        passes: [{ pass: 1, verdict: 'NOPE' as unknown as 'PASS' }],
      }),
    ).toThrow(/invalid verdict/)
  })

  it('latest.json from submit is key-compatible with the claude dispatch path', () => {
    const submitted = submitPlanReview({
      dir: env.dir,
      tier: 'S',
      planContent: PLAN,
      reviewer: 'r',
      taskId: 'parity-submit',
      passes: [
        { pass: 1, verdict: 'PASS' },
        { pass: 2, verdict: 'PASS' },
        { pass: 3, verdict: 'PASS' },
      ],
    })
    const dispatched = dispatchPlanReview({
      planContent: PLAN,
      dir: env.dir,
      tier: 'S',
      taskId: 'parity-dispatch',
      dispatcher: fakeDispatcher('PASS'),
    })
    const sub = JSON.parse(readFileSync(submitted.latestPath, 'utf-8')) as Record<string, unknown>
    const disp = JSON.parse(readFileSync(dispatched.latestPath, 'utf-8')) as Record<string, unknown>
    const required = [
      'verdict',
      'ts',
      'runDir',
      'planDigest',
      'branch',
      'sha',
      'tier',
      'totalInvocations',
      'attempts',
    ]
    for (const k of required) {
      expect(sub[k], `submit latest.json missing key ${k}`).toBeDefined()
      expect(disp[k], `dispatch latest.json missing key ${k}`).toBeDefined()
    }
  })
})

describe('runReviewSubmit CLI entry (#1329)', () => {
  let env: ReturnType<typeof withTempDir>
  beforeEach(() => (env = withTempDir()))
  afterEach(() => env.cleanup())

  it('records verdicts from a plan file and returns the verdict exit code', () => {
    const planFile = join(env.dir, 'plan.md')
    writeFileSync(planFile, PLAN, 'utf-8')
    const result = runReviewSubmit({
      file: planFile,
      dir: env.dir,
      tier: 'XS',
      reviewer: 'agent-harness',
      passes: [{ pass: 1, verdict: 'PASS' }],
    })
    expect(result.exitCode).toBe(0)
    expect(result.verdict).toBe('PASS')
    const runDirs = readdirSync(join(env.dir, '.arbiter', 'evidence', 'plan-review', 'unknown'))
    expect(runDirs.some((d) => d.startsWith('run-') || d === 'latest.json')).toBe(true)
  })

  it('maps a validation error to exit 2 without throwing', () => {
    const planFile = join(env.dir, 'plan.md')
    writeFileSync(planFile, PLAN, 'utf-8')
    const result = runReviewSubmit({
      file: planFile,
      dir: env.dir,
      tier: 'S',
      reviewer: 'agent-harness',
      passes: [{ pass: 1, verdict: 'PASS' }], // too few for tier S (needs 3)
    })
    expect(result.exitCode).toBe(2)
    expect(result.verdict).toBe('ERROR')
  })
})
