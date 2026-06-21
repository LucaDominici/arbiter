// SPDX-License-Identifier: Apache-2.0
/**
 * Branch-coverage climb for `src/commands/verify-plan.ts` (#1486).
 *
 * `runVerifyPlan` has no subagent/network/git seam — it reads a plan file
 * with `node:fs`, parses + schema-validates it, then drives the real
 * `runVerify` engine. Every branch is reachable deterministically with a
 * real `mkdtempSync` temp fixture plus `extraRules` to steer the engine's
 * APPROVED / REJECTED verdict. No process.exit is ever called by this code
 * path, so we simply assert the returned `VerifyPlanResult`.
 *
 * Branches covered:
 *  - missing plan file → IO error  (json + text emit)
 *  - readFileSync throws (path is a directory) → IO error
 *  - invalid JSON → SCHEMA error
 *  - schema-invalid plan → SCHEMA error
 *  - review_bridge.enabled:false → SKIPPED (json + text emit)
 *  - runVerify APPROVED → exit 0 (json + text emit, incl. violation loop)
 *  - runVerify REJECTED via extra rule → exit 2 (json + text emit)
 *  - runVerify throws (dir is a file) → RUNTIME error, and writeErrorReview's
 *    mkdir-fails best-effort branch
 *  - default reviewer fallback vs explicit reviewer
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runVerifyPlan } from '../../src/commands/verify-plan.js'
import type { PlanJsonV1 } from '../../src/types/plan.js'
import type { VerifyPlanRule } from '../../src/verify/rules/types.js'
import type { RuleViolation } from '../../src/verify/rules/types.js'

// ── temp fixture ─────────────────────────────────────────────────────────────

interface Env {
  dir: string
  cleanup: () => void
}

function withDir(): Env {
  const dir = mkdtempSync(join(tmpdir(), 'arbiter-verify-plan-cov-'))
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

/** A minimal schema-valid plan with the review bridge toggled as requested. */
function validPlan(enabled: boolean): PlanJsonV1 {
  return {
    task_id: '#1486',
    scope: { track: 'B' },
    files: [{ path: 'src/x.ts', operation: 'modify' }],
    review_bridge: { enabled, reviewer: 'bridge-reviewer', fail_on_warn: false },
  }
}

function writePlan(dir: string, name: string, plan: PlanJsonV1): string {
  const p = join(dir, name)
  writeFileSync(p, JSON.stringify(plan), 'utf-8')
  return p
}

/** Capture every string written to a stream, restoring on dispose. */
function captureWrites(stream: NodeJS.WriteStream): { lines: string[]; restore: () => void } {
  const lines: string[] = []
  const spy = vi
    .spyOn(stream, 'write')
    .mockImplementation((chunk: string | Uint8Array): boolean => {
      lines.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf-8'))
      return true
    })
  return { lines, restore: () => spy.mockRestore() }
}

/** An extra rule that always emits one violation of the given severity. */
function violatingRule(id: string, severity: 'ERROR' | 'WARN', message: string): VerifyPlanRule {
  return {
    id,
    ssotPointer: { path: 'docs/SYSTEM/CANON.md', anchor: 'test' },
    applicability: (): boolean => true,
    evaluate: (): RuleViolation[] => [
      {
        rule_id: id,
        severity,
        message,
        ssot_pointer: { path: 'docs/SYSTEM/CANON.md', anchor: 'test' },
        evidence: { paths: ['src/x.ts'] },
      },
    ],
  }
}

/** An extra rule that never applies — leaves the verdict APPROVED. */
function inertRule(id: string): VerifyPlanRule {
  return {
    id,
    ssotPointer: { path: 'docs/SYSTEM/CANON.md', anchor: 'test' },
    applicability: (): boolean => false,
    evaluate: (): RuleViolation[] => [],
  }
}

// ── missing plan file ────────────────────────────────────────────────────────

describe('runVerifyPlan — missing plan file (IO)', () => {
  let env: Env
  beforeEach(() => {
    env = withDir()
  })
  afterEach(() => env.cleanup())

  it('text mode writes "plan file not found" to stderr (exit 2)', () => {
    const err = captureWrites(process.stderr)
    try {
      const result = runVerifyPlan({ file: join(env.dir, 'nope.json'), dir: env.dir })
      expect(result.exitCode).toBe(2)
      expect(result.status).toBe('ERROR')
      expect(err.lines.join('')).toMatch(/plan file not found/)
    } finally {
      err.restore()
    }
    // reportError wrote an ERROR review pointer.
    expect(existsSync(join(env.dir, '.arbiter', 'plan', 'REVIEW.json'))).toBe(true)
  })

  it('json mode emits an error envelope and writes a pointer review', () => {
    const out = captureWrites(process.stdout)
    try {
      const result = runVerifyPlan({
        file: join(env.dir, 'absent.json'),
        dir: env.dir,
        json: true,
        reviewer: 'custom-reviewer',
      })
      expect(result.exitCode).toBe(2)
      const env1 = out.lines.find((l: string) => l.includes('"command"'))
      expect(env1).toBeDefined()
      const parsed = JSON.parse(env1 as string) as { command: string; status: string }
      expect(parsed.command).toBe('verify plan')
      expect(parsed.status).toBe('error')
    } finally {
      out.restore()
    }
    const review = JSON.parse(
      readFileSync(join(env.dir, '.arbiter', 'plan', 'REVIEW.json'), 'utf-8'),
    ) as { reviewer: string; status: string }
    expect(review.reviewer).toBe('custom-reviewer')
    expect(review.status).toBe('ERROR')
  })
})

// ── readFileSync throws (path is a directory) ────────────────────────────────

describe('runVerifyPlan — unreadable plan path (IO)', () => {
  let env: Env
  beforeEach(() => {
    env = withDir()
  })
  afterEach(() => env.cleanup())

  it('a directory in place of the plan file surfaces a read failure', () => {
    // The plan "file" is the project dir itself: existsSync() is true but
    // readFileSync() throws EISDIR → the read-failure branch.
    const err = captureWrites(process.stderr)
    try {
      const result = runVerifyPlan({ file: env.dir, dir: env.dir })
      expect(result.exitCode).toBe(2)
      expect(result.status).toBe('ERROR')
      expect(err.lines.join('')).toMatch(/failed to read plan file/)
    } finally {
      err.restore()
    }
  })
})

// ── parse failures ───────────────────────────────────────────────────────────

describe('runVerifyPlan — parse + schema failures (SCHEMA)', () => {
  let env: Env
  beforeEach(() => {
    env = withDir()
  })
  afterEach(() => env.cleanup())

  it('invalid JSON is reported as a SCHEMA error (json envelope)', () => {
    const p = join(env.dir, 'bad.json')
    writeFileSync(p, '{ not json', 'utf-8')
    const out = captureWrites(process.stdout)
    try {
      const result = runVerifyPlan({ file: p, dir: env.dir, json: true })
      expect(result.exitCode).toBe(2)
      const env1 = out.lines.find((l: string) => l.includes('"command"'))
      const parsed = JSON.parse(env1 as string) as { status: string; errors?: string[] }
      expect(parsed.status).toBe('error')
      expect((parsed.errors ?? []).join(' ')).toMatch(/invalid JSON/)
    } finally {
      out.restore()
    }
  })

  it('schema-invalid plan is reported as a SCHEMA error (text mode)', () => {
    const p = join(env.dir, 'wrong-shape.json')
    // Valid JSON, but task_id violates the /^#\d+$/ schema.
    writeFileSync(p, JSON.stringify({ task_id: 'nope', files: [] }), 'utf-8')
    const err = captureWrites(process.stderr)
    try {
      const result = runVerifyPlan({ file: p, dir: env.dir })
      expect(result.exitCode).toBe(2)
      expect(result.status).toBe('ERROR')
      expect(err.lines.join('')).toMatch(/schema validation failed/)
    } finally {
      err.restore()
    }
  })
})

// ── review bridge disabled → SKIPPED ─────────────────────────────────────────

describe('runVerifyPlan — review_bridge.enabled:false (SKIPPED)', () => {
  let env: Env
  beforeEach(() => {
    env = withDir()
  })
  afterEach(() => env.cleanup())

  it('text mode prints SKIPPED and writes PLAN.json + REVIEW.json', () => {
    const p = writePlan(env.dir, 'skip.json', validPlan(false))
    const out = captureWrites(process.stdout)
    try {
      const result = runVerifyPlan({ file: p, dir: env.dir })
      expect(result.exitCode).toBe(0)
      expect(result.status).toBe('SKIPPED')
      expect(out.lines.join('')).toMatch(/SKIPPED \(review_bridge\.enabled:false\)/)
    } finally {
      out.restore()
    }
    expect(existsSync(join(env.dir, '.arbiter', 'plan', 'PLAN.json'))).toBe(true)
    const review = JSON.parse(
      readFileSync(join(env.dir, '.arbiter', 'plan', 'REVIEW.json'), 'utf-8'),
    ) as { status: string; verification: { notes: string[] } }
    expect(review.status).toBe('SKIPPED')
    expect(review.verification.notes).toContain('review_bridge.enabled:false')
  })

  it('json mode emits a SKIPPED ok envelope', () => {
    const p = writePlan(env.dir, 'skip-json.json', validPlan(false))
    const out = captureWrites(process.stdout)
    try {
      const result = runVerifyPlan({ file: p, dir: env.dir, json: true })
      expect(result.status).toBe('SKIPPED')
      const env1 = out.lines.find((l: string) => l.includes('"command"'))
      const parsed = JSON.parse(env1 as string) as {
        status: string
        data: { status: string }
      }
      expect(parsed.status).toBe('ok')
      expect(parsed.data.status).toBe('SKIPPED')
    } finally {
      out.restore()
    }
  })
})

// ── engine: APPROVED + REJECTED ──────────────────────────────────────────────

describe('runVerifyPlan — engine verdicts', () => {
  let env: Env
  beforeEach(() => {
    env = withDir()
  })
  afterEach(() => env.cleanup())

  it('clean plan with an inert extra rule → APPROVED, exit 0 (text)', () => {
    const p = writePlan(env.dir, 'approve.json', validPlan(true))
    const out = captureWrites(process.stdout)
    try {
      const result = runVerifyPlan({
        file: p,
        dir: env.dir,
        extraRules: [inertRule('NEVER_APPLIES')],
      })
      expect(result.exitCode).toBe(0)
      expect(result.status).toBe('APPROVED')
      expect(result.runId).toBeDefined()
      expect(result.reviewPath).toMatch(/REVIEW\.json$/)
      expect(out.lines.join('')).toMatch(/verify plan: APPROVED/)
    } finally {
      out.restore()
    }
  })

  it('clean plan → APPROVED with a --json ok envelope', () => {
    const p = writePlan(env.dir, 'approve-json.json', validPlan(true))
    const out = captureWrites(process.stdout)
    try {
      const result = runVerifyPlan({ file: p, dir: env.dir, json: true })
      expect(result.exitCode).toBe(0)
      const env1 = out.lines.find((l: string) => l.includes('"command"'))
      const parsed = JSON.parse(env1 as string) as {
        status: string
        data: { status: string; violations: number }
      }
      expect(parsed.status).toBe('ok')
      expect(parsed.data.status).toBe('APPROVED')
      expect(parsed.data.violations).toBe(0)
    } finally {
      out.restore()
    }
  })

  it('extra ERROR rule → REJECTED, exit 2, prints the violation line (text)', () => {
    const p = writePlan(env.dir, 'reject.json', validPlan(true))
    const out = captureWrites(process.stdout)
    try {
      const result = runVerifyPlan({
        file: p,
        dir: env.dir,
        extraRules: [violatingRule('EXTRA_BLOCK', 'ERROR', 'hard blocker')],
      })
      expect(result.exitCode).toBe(2)
      expect(result.status).toBe('REJECTED')
      const text = out.lines.join('')
      expect(text).toMatch(/verify plan: REJECTED/)
      // emitVerifyResult's violation loop renders the single violation.
      expect(text).toMatch(/\[ERROR EXTRA_BLOCK\] hard blocker/)
    } finally {
      out.restore()
    }
  })

  it('extra ERROR rule → REJECTED with a --json error envelope', () => {
    const p = writePlan(env.dir, 'reject-json.json', validPlan(true))
    const out = captureWrites(process.stdout)
    try {
      const result = runVerifyPlan({
        file: p,
        dir: env.dir,
        json: true,
        // explicit reviewer + failOnWarn flow through to runVerify.
        reviewer: 'gate',
        failOnWarn: true,
        extraRules: [violatingRule('EXTRA_BLOCK2', 'ERROR', 'blocked')],
      })
      expect(result.exitCode).toBe(2)
      const env1 = out.lines.find((l: string) => l.includes('"command"'))
      const parsed = JSON.parse(env1 as string) as {
        status: string
        data: { status: string; violations: number }
      }
      expect(parsed.status).toBe('error')
      expect(parsed.data.status).toBe('REJECTED')
      expect(parsed.data.violations).toBe(1)
    } finally {
      out.restore()
    }
  })

  it('WARN rule with failOnWarn:true → REJECTED', () => {
    const p = writePlan(env.dir, 'warn-fail.json', validPlan(true))
    const out = captureWrites(process.stdout)
    try {
      const result = runVerifyPlan({
        file: p,
        dir: env.dir,
        failOnWarn: true,
        extraRules: [violatingRule('EXTRA_WARN', 'WARN', 'soft issue')],
      })
      expect(result.status).toBe('REJECTED')
      expect(result.exitCode).toBe(2)
    } finally {
      out.restore()
    }
  })
})

// ── engine throws → RUNTIME ──────────────────────────────────────────────────

describe('runVerifyPlan — engine failure (RUNTIME)', () => {
  let env: Env
  beforeEach(() => {
    env = withDir()
  })
  afterEach(() => env.cleanup())

  it('a file in place of the target dir makes runVerify throw → RUNTIME error', () => {
    // The plan lives in env.dir; the *target dir* we pass is a regular file,
    // so runVerify's mkdirSync(runDir) throws (ENOTDIR). That is caught by the
    // RUNTIME branch — and reportError's own mkdir then fails best-effort.
    const planPath = writePlan(env.dir, 'runtime.json', validPlan(true))
    const fileAsDir = join(env.dir, 'not-a-dir')
    writeFileSync(fileAsDir, 'i am a file\n', 'utf-8')

    const err = captureWrites(process.stderr)
    try {
      const result = runVerifyPlan({ file: planPath, dir: fileAsDir })
      expect(result.exitCode).toBe(2)
      expect(result.status).toBe('ERROR')
      // Either the engine-failure stderr or the pointer-dir best-effort warning
      // is acceptable evidence the RUNTIME path ran; the engine message is the
      // primary one.
      expect(err.lines.join('')).toMatch(/verification engine failed|could not create pointer dir/)
    } finally {
      err.restore()
    }
  })
})
