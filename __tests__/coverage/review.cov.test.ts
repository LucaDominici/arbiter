// SPDX-License-Identifier: Apache-2.0
/**
 * Branch-coverage climb for `src/commands/review.ts` (#1486).
 *
 * Exercises the emit-prompts path, the agent-agnostic `review submit` path
 * (success / validation-error / missing-file, json + text), the tier
 * resolution branches (XS/S/M/L/Standard/empty/unknown/invalid), and the
 * remaining `review code` text-output branches (notes + finding locations).
 * All git/gh/claude/fs side effects are stubbed via the modules' injected
 * deps or a real temp fixture dir — no network, no real subagent.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync, existsSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runReviewPlan, runReviewSubmit, runReviewCode } from '../../src/commands/review.js'
import type { SubagentDispatcher, SubmittedPass } from '../../src/review/dispatch.js'
import type { DispatchFn, Finding } from '../../src/review/multi-agent.js'
import { writeUnifiedState } from '../../src/commands/task-state.js'

// ── temp project fixture ─────────────────────────────────────────────────────

interface ProjectEnv {
  dir: string
  planPath: string
  cleanup: () => void
}

function withProjectDir(): ProjectEnv {
  const dir = mkdtempSync(join(tmpdir(), 'arbiter-review-cov-'))
  writeFileSync(join(dir, 'AGENTS.md'), '# project agents\n')
  const planPath = join(dir, 'plan.md')
  writeFileSync(planPath, '# Plan\n\nDo the thing safely.\n')
  return { dir, planPath, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

function passDispatcher(verdict: 'PASS' | 'WARN' | 'FAIL'): SubagentDispatcher {
  return { run: () => ({ stdout: `verdict: ${verdict}\n`, exitCode: 0 }) }
}

function noopCodeDispatcher(byAgent: Record<string, Finding[]> = {}): DispatchFn {
  return async (prompt: string, agentName: string) => {
    const findings = byAgent[agentName] ?? []
    return {
      agent: agentName,
      findings,
      passed: findings.length === 0,
      rawStdout: JSON.stringify({ findings, passed: findings.length === 0 }),
      prompt,
    }
  }
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

const FIXED_DIFF = 'diff --git a/x b/x\n+a\n'

// ── runReviewPlan: emit-prompts + json branches ──────────────────────────────

describe('runReviewPlan — emit-prompts branch (#1329)', () => {
  let env: ProjectEnv
  beforeEach(() => {
    env = withProjectDir()
  })
  afterEach(() => env.cleanup())

  it('emits prompt files and returns PASS (text output)', () => {
    const out = captureWrites(process.stdout)
    try {
      const emitDir = join(env.dir, 'emitted')
      const result = runReviewPlan({
        file: env.planPath,
        dir: env.dir,
        tier: 'S',
        emitPrompts: emitDir,
      })
      expect(result.exitCode).toBe(0)
      expect(result.verdict).toBe('PASS')
      // S tier → 3 prompt passes written
      const files = readdirSync(emitDir).filter((f: string) => f.startsWith('pass-'))
      expect(files).toHaveLength(3)
      expect(existsSync(join(emitDir, 'manifest.json'))).toBe(true)
      expect(out.lines.join('')).toMatch(/emitted 3 prompt/)
    } finally {
      out.restore()
    }
  })

  it('emits prompts with --json envelope', () => {
    const out = captureWrites(process.stdout)
    try {
      const emitDir = join(env.dir, 'emitted-json')
      const result = runReviewPlan({
        file: env.planPath,
        dir: env.dir,
        tier: 'XS',
        emitPrompts: emitDir,
        json: true,
      })
      expect(result.exitCode).toBe(0)
      const env1 = out.lines.find((l: string) => l.includes('"command"'))
      expect(env1).toBeDefined()
      const parsed = JSON.parse(env1 as string)
      expect(parsed.command).toBe('review plan')
      expect(parsed.status).toBe('ok')
      expect(parsed.data.emitted).toBe(true)
      expect(parsed.data.passCount).toBe(1)
    } finally {
      out.restore()
    }
  })

  it('missing plan file emits a --json error envelope (exit 2)', () => {
    const out = captureWrites(process.stdout)
    try {
      const result = runReviewPlan({
        file: join(env.dir, 'nope.md'),
        dir: env.dir,
        json: true,
        dispatcher: passDispatcher('PASS'),
      })
      expect(result.exitCode).toBe(2)
      expect(result.verdict).toBe('ERROR')
      const env1 = out.lines.find((l: string) => l.includes('"command"'))
      expect(env1).toBeDefined()
      const parsed = JSON.parse(env1 as string)
      expect(parsed.status).toBe('error')
    } finally {
      out.restore()
    }
  })

  it('missing plan file writes a text error to stderr (exit 2)', () => {
    const err = captureWrites(process.stderr)
    try {
      const result = runReviewPlan({
        file: join(env.dir, 'absent.md'),
        dir: env.dir,
        dispatcher: passDispatcher('PASS'),
      })
      expect(result.exitCode).toBe(2)
      expect(err.lines.join('')).toMatch(/plan file not found/)
    } finally {
      err.restore()
    }
  })

  it('dispatch path with --json emits a verdict envelope', () => {
    const out = captureWrites(process.stdout)
    try {
      const result = runReviewPlan({
        file: env.planPath,
        dir: env.dir,
        tier: 'XS',
        json: true,
        dispatcher: passDispatcher('PASS'),
      })
      expect(result.verdict).toBe('PASS')
      const env1 = out.lines.find((l: string) => l.includes('"command"'))
      const parsed = JSON.parse(env1 as string)
      expect(parsed.command).toBe('review plan')
      expect(parsed.status).toBe('ok')
      expect(parsed.data.verdict).toBe('PASS')
    } finally {
      out.restore()
    }
  })

  it('persistent WARN exhausts revise cycles and maps to error json status', () => {
    const out = captureWrites(process.stdout)
    try {
      // A constant-WARN dispatcher never settles: the revise loop exhausts
      // MAX_REVISE_CYCLES and the residual WARN finalises as FAIL (error).
      const result = runReviewPlan({
        file: env.planPath,
        dir: env.dir,
        tier: 'XS',
        json: true,
        dispatcher: passDispatcher('WARN'),
      })
      expect(result.verdict).toBe('FAIL')
      expect(result.exitCode).toBe(2)
      const env1 = out.lines.find((l: string) => l.includes('"command"'))
      const parsed = JSON.parse(env1 as string)
      expect(parsed.status).toBe('error')
    } finally {
      out.restore()
    }
  })
})

// ── tier resolution branches (via runReviewPlan dispatch count) ───────────────

describe('runReviewPlan — tier resolution branches', () => {
  let env: ProjectEnv
  beforeEach(() => {
    env = withProjectDir()
  })
  afterEach(() => env.cleanup())

  function countingDispatcher(): { dispatcher: SubagentDispatcher; calls: { n: number } } {
    const calls = { n: 0 }
    return {
      calls,
      dispatcher: {
        run: () => {
          calls.n++
          return { stdout: 'verdict: PASS\n', exitCode: 0 }
        },
      },
    }
  }

  it('M tier in state → Standard → 5 passes', () => {
    writeUnifiedState(env.dir, { tier: 'M' })
    const { dispatcher, calls } = countingDispatcher()
    runReviewPlan({ file: env.planPath, dir: env.dir, dispatcher })
    expect(calls.n).toBe(5)
  })

  it('explicit XS tier overrides L in state → 1 pass', () => {
    writeUnifiedState(env.dir, { tier: 'L' })
    const { dispatcher, calls } = countingDispatcher()
    runReviewPlan({ file: env.planPath, dir: env.dir, tier: 'XS', dispatcher })
    expect(calls.n).toBe(1)
  })

  it('empty tier string in state falls back to XS default → 1 pass', () => {
    writeUnifiedState(env.dir, { tier: '   ' })
    const { dispatcher, calls } = countingDispatcher()
    runReviewPlan({ file: env.planPath, dir: env.dir, dispatcher })
    expect(calls.n).toBe(1)
  })

  it('unknown tier value in state throws a clear error', () => {
    writeUnifiedState(env.dir, { tier: 'Mega' })
    const { dispatcher } = countingDispatcher()
    expect(() => runReviewPlan({ file: env.planPath, dir: env.dir, dispatcher })).toThrow(
      /Unknown tier "Mega"/,
    )
  })
})

// ── runReviewSubmit (#1329) ──────────────────────────────────────────────────

describe('runReviewSubmit (#1329)', () => {
  let env: ProjectEnv
  beforeEach(() => {
    env = withProjectDir()
  })
  afterEach(() => env.cleanup())

  it('records valid passes and returns PASS (text output)', () => {
    const out = captureWrites(process.stdout)
    try {
      const passes: readonly SubmittedPass[] = [{ pass: 1, verdict: 'PASS' }]
      const result = runReviewSubmit({
        file: env.planPath,
        dir: env.dir,
        tier: 'XS',
        reviewer: 'agent-x',
        passes,
      })
      expect(result.exitCode).toBe(0)
      expect(result.verdict).toBe('PASS')
      expect(out.lines.join('')).toMatch(/review submit: PASS/)
    } finally {
      out.restore()
    }
  })

  it('records valid passes and emits a --json success envelope', () => {
    const out = captureWrites(process.stdout)
    try {
      const passes: readonly SubmittedPass[] = [{ pass: 1, verdict: 'PASS' }]
      const result = runReviewSubmit({
        file: env.planPath,
        dir: env.dir,
        tier: 'XS',
        reviewer: 'agent-json',
        passes,
        json: true,
      })
      expect(result.verdict).toBe('PASS')
      const env1 = out.lines.find((l: string) => l.includes('"command"'))
      const parsed = JSON.parse(env1 as string)
      expect(parsed.command).toBe('review submit')
      expect(parsed.status).toBe('ok')
      expect(parsed.data.reviewer).toBe('agent-json')
      expect(parsed.data.latestPath).toBeDefined()
    } finally {
      out.restore()
    }
  })

  it('single WARN pass yields WARN verdict and warning json status (exit 1)', () => {
    const out = captureWrites(process.stdout)
    try {
      // XS submit uses attempts=1 (no revise loop), so a lone WARN survives as
      // WARN — exercising verdictToJsonStatus('WARN') → 'warning'.
      const passes: readonly SubmittedPass[] = [{ pass: 1, verdict: 'WARN' }]
      const result = runReviewSubmit({
        file: env.planPath,
        dir: env.dir,
        tier: 'XS',
        reviewer: 'agent-warn',
        passes,
        json: true,
      })
      expect(result.verdict).toBe('WARN')
      expect(result.exitCode).toBe(1)
      const env1 = out.lines.find((l: string) => l.includes('"command"'))
      const parsed = JSON.parse(env1 as string)
      expect(parsed.status).toBe('warning')
    } finally {
      out.restore()
    }
  })

  it('FAIL pass produces a FAIL verdict (exit 2)', () => {
    const out = captureWrites(process.stdout)
    try {
      const passes: readonly SubmittedPass[] = [{ pass: 1, verdict: 'FAIL', notes: 'blocker' }]
      const result = runReviewSubmit({
        file: env.planPath,
        dir: env.dir,
        tier: 'XS',
        reviewer: 'agent-fail',
        passes,
      })
      expect(result.exitCode).toBe(2)
      expect(result.verdict).toBe('FAIL')
    } finally {
      out.restore()
    }
  })

  it('wrong pass count surfaces a validation error (text, exit 2)', () => {
    const err = captureWrites(process.stderr)
    try {
      // XS expects exactly 1 pass; supply 2.
      const passes: readonly SubmittedPass[] = [
        { pass: 1, verdict: 'PASS' },
        { pass: 2, verdict: 'PASS' },
      ]
      const result = runReviewSubmit({
        file: env.planPath,
        dir: env.dir,
        tier: 'XS',
        reviewer: 'agent-bad',
        passes,
      })
      expect(result.exitCode).toBe(2)
      expect(result.verdict).toBe('ERROR')
      expect(err.lines.join('')).toMatch(/review submit/)
      expect(result.reason).toMatch(/expected 1 pass/)
    } finally {
      err.restore()
    }
  })

  it('validation error surfaces in a --json error envelope', () => {
    const out = captureWrites(process.stdout)
    try {
      // Duplicate pass index is a SubmitValidationError for S tier (3 passes).
      const passes: readonly SubmittedPass[] = [
        { pass: 1, verdict: 'PASS' },
        { pass: 1, verdict: 'PASS' },
        { pass: 3, verdict: 'PASS' },
      ]
      const result = runReviewSubmit({
        file: env.planPath,
        dir: env.dir,
        tier: 'S',
        reviewer: 'agent-dup',
        passes,
        json: true,
      })
      expect(result.exitCode).toBe(2)
      expect(result.verdict).toBe('ERROR')
      const env1 = out.lines.find((l: string) => l.includes('"command"'))
      const parsed = JSON.parse(env1 as string)
      expect(parsed.status).toBe('error')
    } finally {
      out.restore()
    }
  })

  it('missing plan file returns ERROR (text error to stderr)', () => {
    const err = captureWrites(process.stderr)
    try {
      const passes: readonly SubmittedPass[] = [{ pass: 1, verdict: 'PASS' }]
      const result = runReviewSubmit({
        file: join(env.dir, 'missing.md'),
        dir: env.dir,
        tier: 'XS',
        reviewer: 'agent-m',
        passes,
      })
      expect(result.exitCode).toBe(2)
      expect(result.verdict).toBe('ERROR')
      expect(result.reason).toMatch(/plan file not found/)
      expect(err.lines.join('')).toMatch(/plan file not found/)
    } finally {
      err.restore()
    }
  })

  it('missing plan file returns ERROR in a --json envelope', () => {
    const out = captureWrites(process.stdout)
    try {
      const passes: readonly SubmittedPass[] = [{ pass: 1, verdict: 'PASS' }]
      const result = runReviewSubmit({
        file: join(env.dir, 'missing2.md'),
        dir: env.dir,
        tier: 'XS',
        reviewer: 'agent-mj',
        passes,
        json: true,
      })
      expect(result.exitCode).toBe(2)
      const env1 = out.lines.find((l: string) => l.includes('"command"'))
      const parsed = JSON.parse(env1 as string)
      expect(parsed.status).toBe('error')
    } finally {
      out.restore()
    }
  })

  it('resolves tier from task state when opts.tier omitted', () => {
    writeUnifiedState(env.dir, { tier: 'S' })
    const out = captureWrites(process.stdout)
    try {
      const passes: readonly SubmittedPass[] = [
        { pass: 1, verdict: 'PASS' },
        { pass: 2, verdict: 'PASS' },
        { pass: 3, verdict: 'PASS' },
      ]
      const result = runReviewSubmit({
        file: env.planPath,
        dir: env.dir,
        reviewer: 'agent-tier',
        passes,
      })
      // 3 passes accepted only because S tier was read from state.
      expect(result.verdict).toBe('PASS')
      expect(result.exitCode).toBe(0)
    } finally {
      out.restore()
    }
  })
})

// ── runReviewCode text-output branches (notes + locations) ────────────────────

describe('runReviewCode — text output branches (#236)', () => {
  let env: ProjectEnv
  beforeEach(() => {
    env = withProjectDir()
  })
  afterEach(() => env.cleanup())

  it('prints blockers, warnings and notes with locations in text mode', async () => {
    const out = captureWrites(process.stdout)
    try {
      const byAgent: Record<string, Finding[]> = {
        bugs: [
          { severity: 'blocker', agent: 'bugs', message: 'crash', location: 'a.ts:10' },
          { severity: 'warning', agent: 'bugs', message: 'smell', location: 'b.ts:2' },
          { severity: 'note', agent: 'bugs', message: 'nit', location: 'c.ts:5' },
        ],
      }
      const result = await runReviewCode({
        dir: env.dir,
        tier: 'S',
        diffOverride: FIXED_DIFF,
        dispatcher: noopCodeDispatcher(byAgent),
      })
      expect(result.exitCode).toBe(2)
      const text = out.lines.join('')
      expect(text).toMatch(/\[BLOCKER bugs\] crash \(a\.ts:10\)/)
      expect(text).toMatch(/\[WARN bugs\] smell \(b\.ts:2\)/)
      expect(text).toMatch(/\[NOTE bugs\] nit \(c\.ts:5\)/)
      expect(text).toMatch(/evidence:/)
    } finally {
      out.restore()
    }
  })

  it('prints findings without locations (no parenthetical)', async () => {
    const out = captureWrites(process.stdout)
    try {
      const byAgent: Record<string, Finding[]> = {
        bugs: [{ severity: 'note', agent: 'bugs', message: 'plain note' }],
      }
      const result = await runReviewCode({
        dir: env.dir,
        tier: 'S',
        diffOverride: FIXED_DIFF,
        dispatcher: noopCodeDispatcher(byAgent),
      })
      expect(result.exitCode).toBe(0)
      const text = out.lines.join('')
      expect(text).toMatch(/\[NOTE bugs\] plain note\n/)
      // No location → no trailing parenthesis on that note line.
      expect(text).not.toMatch(/plain note \(/)
    } finally {
      out.restore()
    }
  })

  it('defaults tier to Standard (5 agents) when omitted', async () => {
    const seen: string[] = []
    const result = await runReviewCode({
      dir: env.dir,
      diffOverride: FIXED_DIFF,
      dispatcher: async (prompt: string, agentName: string) => {
        seen.push(agentName)
        return { agent: agentName, findings: [], passed: true, rawStdout: '{}', prompt }
      },
    })
    expect(result.aggregated.totalAgents).toBe(5)
    expect(seen).toHaveLength(5)
  })

  it('infra failure (no diff override, no git repo) becomes a blocker via --json', async () => {
    const out = captureWrites(process.stdout)
    try {
      const result = await runReviewCode({ dir: env.dir, tier: 'S', json: true })
      expect(result.exitCode).toBe(2)
      const env1 = out.lines.find((l: string) => l.includes('"command"'))
      const parsed = JSON.parse(env1 as string)
      expect(parsed.command).toBe('review code')
      expect(parsed.status).toBe('error')
      expect(parsed.data.blockers.length).toBeGreaterThan(0)
    } finally {
      out.restore()
    }
  })

  it('infra failure reports to stderr in text mode', async () => {
    const err = captureWrites(process.stderr)
    try {
      const result = await runReviewCode({ dir: env.dir, tier: 'S' })
      expect(result.exitCode).toBe(2)
      expect(err.lines.join('')).toMatch(/infrastructure failure/)
    } finally {
      err.restore()
    }
  })
})
