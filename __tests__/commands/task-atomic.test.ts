// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, existsSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createTestProject, cleanupTestProject } from '../helpers.js'
import {
  writeTaskStatus,
  runTaskResume,
  runTaskAdvance,
  writeBacklog,
  runTaskRecover,
  requirePlanReviewPass,
} from '../../src/commands/task.js'
import type { RunCliResult } from '../../src/utils/run-cli.js'

describe('writeTaskStatus — atomic write (#690)', () => {
  let dir: string
  let claudeDir: string
  let taskDir: string

  beforeEach(() => {
    dir = createTestProject()
    claudeDir = join(dir, '.claude')
    taskDir = join(claudeDir, '.task-test')
    mkdirSync(taskDir, { recursive: true })
  })

  afterEach(() => {
    cleanupTestProject(dir)
  })

  it('writes status.json to the target directory', () => {
    writeTaskStatus({ taskDir, phase: 'plan' })
    const statusPath = join(taskDir, 'status.json')
    expect(existsSync(statusPath)).toBe(true)
  })

  it('status.json contains required schema fields', () => {
    writeTaskStatus({ taskDir, phase: 'implementation' })
    const raw = readFileSync(join(taskDir, 'status.json'), 'utf-8')
    const parsed = JSON.parse(raw) as Record<string, unknown>
    expect(parsed).toHaveProperty('phase', 'implementation')
    expect(parsed).toHaveProperty('timestamps')
    expect(parsed).toHaveProperty('runId')
    expect(parsed).toHaveProperty('gateDecisions')
    expect(Array.isArray(parsed.gateDecisions)).toBe(true)
  })

  it('status.json runId is non-empty string', () => {
    writeTaskStatus({ taskDir, phase: 'plan' })
    const parsed = JSON.parse(readFileSync(join(taskDir, 'status.json'), 'utf-8')) as {
      runId: string
    }
    expect(typeof parsed.runId).toBe('string')
    expect(parsed.runId.length).toBeGreaterThan(0)
  })

  it('leaves no .tmp files after successful write', () => {
    writeTaskStatus({ taskDir, phase: 'plan' })
    const files = readdirSync(taskDir)
    const tmpFiles = files.filter((f) => f.includes('.tmp.') || f.includes('.arbiter-tmp-'))
    expect(tmpFiles).toHaveLength(0)
  })

  it('accepts optional task field in extras', () => {
    writeTaskStatus({ taskDir, phase: 'plan', extras: { task: '#123' } })
    const parsed = JSON.parse(readFileSync(join(taskDir, 'status.json'), 'utf-8')) as {
      task: string
    }
    expect(parsed.task).toBe('#123')
  })

  it('merges timestamps on second write — both phases preserved', () => {
    writeTaskStatus({ taskDir, phase: 'plan' })
    writeTaskStatus({ taskDir, phase: 'implementation' })
    const parsed = JSON.parse(readFileSync(join(taskDir, 'status.json'), 'utf-8')) as {
      timestamps: Record<string, string>
    }
    expect(parsed.timestamps).toHaveProperty('plan')
    expect(parsed.timestamps).toHaveProperty('implementation')
  })

  it('extras cannot overwrite required fields (phase, runId, gateDecisions)', () => {
    writeTaskStatus({
      taskDir,
      phase: 'plan',
      extras: { phase: 'complete', runId: 'injected', gateDecisions: ['fake'] },
    })
    const parsed = JSON.parse(readFileSync(join(taskDir, 'status.json'), 'utf-8')) as Record<
      string,
      unknown
    >
    expect(parsed.phase).toBe('plan')
    expect(parsed.runId).not.toBe('injected')
    expect(Array.isArray(parsed.gateDecisions)).toBe(true)
    expect((parsed.gateDecisions as unknown[]).length).toBe(0)
  })
})

describe('runTaskResume — recovery table (#690)', () => {
  let dir: string
  let claudeDir: string

  beforeEach(() => {
    dir = createTestProject()
    claudeDir = join(dir, '.claude')
    mkdirSync(claudeDir, { recursive: true })
  })

  afterEach(() => {
    cleanupTestProject(dir)
  })

  it('defaults to preflight recovery when .task-phase missing', () => {
    let output = ''
    const originalWrite = process.stdout.write.bind(process.stdout)
    process.stdout.write = (chunk: string) => {
      output += chunk
      return true
    }
    try {
      runTaskResume({ dir })
    } finally {
      process.stdout.write = originalWrite
    }
    expect(output).toMatch(/preflight/i)
  })

  it('returns implementation recovery for implementation phase', () => {
    writeFileSync(join(claudeDir, '.task-phase'), 'implementation\n')
    let output = ''
    const originalWrite = process.stdout.write.bind(process.stdout)
    process.stdout.write = (chunk: string) => {
      output += chunk
      return true
    }
    try {
      runTaskResume({ dir })
    } finally {
      process.stdout.write = originalWrite
    }
    expect(output).toMatch(/implementation/i)
    expect(output).toMatch(/check-all/i)
  })

  it('prepends task ID header when .task-id exists', () => {
    writeFileSync(join(claudeDir, '.task-phase'), 'plan\n')
    writeFileSync(join(claudeDir, '.task-id'), '#456\n')
    let output = ''
    const originalWrite = process.stdout.write.bind(process.stdout)
    process.stdout.write = (chunk: string) => {
      output += chunk
      return true
    }
    try {
      runTaskResume({ dir })
    } finally {
      process.stdout.write = originalWrite
    }
    expect(output).toMatch(/Task: #456/)
  })

  it('does not crash when .task-id is absent', () => {
    writeFileSync(join(claudeDir, '.task-phase'), 'verification\n')
    expect(() => runTaskResume({ dir })).not.toThrow()
  })

  it('throws on corrupted phase value', () => {
    writeFileSync(join(claudeDir, '.task-phase'), 'not-a-real-phase\n')
    expect(() => runTaskResume({ dir })).toThrow(/Corrupted phase/)
  })

  it('returns red-team-review recovery action for red-team-review phase (#691)', () => {
    writeFileSync(join(claudeDir, '.task-phase'), 'red-team-review\n')
    let output = ''
    const originalWrite = process.stdout.write.bind(process.stdout)
    process.stdout.write = (chunk: string) => {
      output += chunk
      return true
    }
    try {
      runTaskResume({ dir })
    } finally {
      process.stdout.write = originalWrite
    }
    expect(output).toMatch(/red-team/i)
    expect(output).toMatch(/evidence\/redteam|redteam/)
  })

  it('returns red-team-rework recovery action for red-team-rework phase (#691)', () => {
    writeFileSync(join(claudeDir, '.task-phase'), 'red-team-rework\n')
    let output = ''
    const originalWrite = process.stdout.write.bind(process.stdout)
    process.stdout.write = (chunk: string) => {
      output += chunk
      return true
    }
    try {
      runTaskResume({ dir })
    } finally {
      process.stdout.write = originalWrite
    }
    expect(output).toMatch(/rework|critical|re-run plan/i)
  })
})

describe('writeTaskStatus — branch field (#690)', () => {
  let dir: string
  let taskDir: string

  beforeEach(() => {
    dir = createTestProject()
    taskDir = join(dir, '.claude', '.task-test')
    mkdirSync(taskDir, { recursive: true })
  })

  afterEach(() => {
    cleanupTestProject(dir)
  })

  it('persists branch field from extras', () => {
    writeTaskStatus({ taskDir, phase: 'plan', extras: { branch: 'task/#689-r1-s-bundle' } })
    const parsed = JSON.parse(readFileSync(join(taskDir, 'status.json'), 'utf-8')) as {
      branch: string
    }
    expect(parsed.branch).toBe('task/#689-r1-s-bundle')
  })
})

describe('runTaskAdvance — red-team phases (#691)', () => {
  let dir: string
  let claudeDir: string

  beforeEach(() => {
    dir = createTestProject()
    claudeDir = join(dir, '.claude')
    mkdirSync(claudeDir, { recursive: true })
  })

  afterEach(() => {
    cleanupTestProject(dir)
  })

  function setPhase(phase: string) {
    writeFileSync(join(claudeDir, '.task-phase'), phase + '\n')
  }

  function readPhaseFile(): string {
    return readFileSync(join(claudeDir, '.task-phase'), 'utf-8').trim()
  }

  it('advances plan → red-team-review sequentially', () => {
    setPhase('plan')
    runTaskAdvance({ to: 'red-team-review', dir })
    expect(readPhaseFile()).toBe('red-team-review')
  })

  it('advances plan → red-team-rework (lateral — skips order check)', () => {
    setPhase('plan')
    runTaskAdvance({ to: 'red-team-rework', dir })
    expect(readPhaseFile()).toBe('red-team-rework')
  })

  it('exits red-team-rework → plan without --reverse (lateral exit)', () => {
    setPhase('red-team-rework')
    expect(() => runTaskAdvance({ to: 'plan', dir })).not.toThrow()
    expect(readPhaseFile()).toBe('plan')
  })

  it('exits red-team-rework → red-team-review without --reverse', () => {
    setPhase('red-team-rework')
    expect(() => runTaskAdvance({ to: 'red-team-review', dir })).not.toThrow()
    expect(readPhaseFile()).toBe('red-team-review')
  })

  it('sequential phases still enforce ordering when neither side is lateral', () => {
    setPhase('preflight')
    expect(() => runTaskAdvance({ to: 'implementation', dir })).toThrow(/Illegal skip/)
  })

  it('preflight → plan → red-team-review → implementation sequential chain works', () => {
    setPhase('preflight')
    runTaskAdvance({ to: 'plan', dir })
    runTaskAdvance({ to: 'red-team-review', dir })
    runTaskAdvance({ to: 'implementation', dir })
    expect(readPhaseFile()).toBe('implementation')
  })

  it('isValidPhase accepts red-team-rework (not in PHASE_ORDER)', () => {
    // Validated indirectly: advance to lateral phase succeeds without throwing "Invalid --to value"
    setPhase('plan')
    expect(() => runTaskAdvance({ to: 'red-team-rework', dir })).not.toThrow()
  })

  it('round-trip: write red-team-review phase → resume outputs matching recovery (#690)', () => {
    writeTaskStatus({
      taskDir: join(claudeDir, '.task-test'),
      phase: 'red-team-review',
    })
    setPhase('red-team-review')

    let output = ''
    const originalWrite = process.stdout.write.bind(process.stdout)
    process.stdout.write = (chunk: string) => {
      output += chunk
      return true
    }
    try {
      runTaskResume({ dir })
    } finally {
      process.stdout.write = originalWrite
    }

    expect(output).toMatch(/red-team/i)
  })
})

/* ──────────────────────────  #694 — backlog + recover  ────────────────────────── */

function makeRunner(replies: Array<{ stdout: string }>): {
  runner: (cmd: string, args: readonly string[]) => RunCliResult
  calls: Array<{ cmd: string; args: readonly string[] }>
} {
  const calls: Array<{ cmd: string; args: readonly string[] }> = []
  let i = 0
  const runner = (cmd: string, args: readonly string[]): RunCliResult => {
    calls.push({ cmd, args })
    const r = replies[i] ?? { stdout: '' }
    i++
    return { stdout: r.stdout, stderr: '', exitCode: 0, durationMs: 0 }
  }
  return { runner, calls }
}

describe('writeBacklog (#694)', () => {
  let dir: string
  beforeEach(() => {
    dir = createTestProject()
  })
  afterEach(() => cleanupTestProject(dir))

  it('writes BACKLOG.md atomically to sanitized path', () => {
    writeBacklog({ taskDir: dir, taskId: '#694', content: '# backlog\n- step 1\n' })
    const expected = join(dir, '.arbiter', 'evidence', '_694', 'BACKLOG.md')
    expect(existsSync(expected)).toBe(true)
    expect(readFileSync(expected, 'utf-8')).toContain('step 1')
  })

  it('sanitizes path traversal in taskId', () => {
    writeBacklog({ taskDir: dir, taskId: '../../etc', content: 'x' })
    const evDir = join(dir, '.arbiter', 'evidence')
    const subdirs = readdirSync(evDir)
    expect(subdirs.every((s) => !s.includes('..'))).toBe(true)
  })

  it('round-trip: write then read returns same content', () => {
    const c = '# Layer 1 — done\n- foo\n- bar\n'
    writeBacklog({ taskDir: dir, taskId: '#999', content: c })
    const r = readFileSync(join(dir, '.arbiter', 'evidence', '_999', 'BACKLOG.md'), 'utf-8')
    expect(r).toBe(c)
  })

  it('leaves no .tmp files after write', () => {
    writeBacklog({ taskDir: dir, taskId: '#1', content: 'x' })
    const files = readdirSync(join(dir, '.arbiter', 'evidence', '_1'))
    expect(files.filter((f) => f.includes('.tmp'))).toHaveLength(0)
  })
})

describe('runTaskRecover (#694)', () => {
  let dir: string
  beforeEach(() => {
    dir = createTestProject()
    mkdirSync(join(dir, '.claude'), { recursive: true })
  })
  afterEach(() => cleanupTestProject(dir))

  function captureStdout(fn: () => void): string {
    let output = ''
    const original = process.stdout.write.bind(process.stdout)
    process.stdout.write = (chunk: string) => {
      output += chunk
      return true
    }
    try {
      fn()
    } finally {
      process.stdout.write = original
    }
    return output
  }

  it('includes BACKLOG.md content when present', () => {
    writeBacklog({ taskDir: dir, taskId: '#42', content: '# BACKLOG body\n- todo X\n' })
    const { runner } = makeRunner([{ stdout: '' }, { stdout: '' }])
    const out = captureStdout(() => runTaskRecover({ dir, taskId: '#42', runner }))
    expect(out).toMatch(/BACKLOG body/)
    expect(out).toMatch(/todo X/)
  })

  it('works with missing BACKLOG.md (only git log layers)', () => {
    const { runner } = makeRunner([
      { stdout: 'abc123 CHECKPOINT(#1) feat 2026-05-15' },
      { stdout: 'def456 plan 2026-05-14' },
    ])
    const out = captureStdout(() => runTaskRecover({ dir, taskId: '#1', runner }))
    expect(out).toMatch(/CHECKPOINT/)
  })

  it('passes SANITIZED id to git --grep (regex metachars stripped from id)', () => {
    const { runner, calls } = makeRunner([{ stdout: '' }, { stdout: '' }])
    runTaskRecover({ dir, taskId: '#694.*', runner })
    const grepCall = calls.find((c) => c.args.includes('--grep'))
    expect(grepCall).toBeDefined()
    const grepArg = grepCall?.args[grepCall.args.indexOf('--grep') + 1] as string
    // # is a literal prefix from the CHECKPOINT(#...) template; safe under git's
    // default grep and explicitly safe under --fixed-strings. What matters: no
    // user-supplied metachars (., *, /, ..) leak into the regex value.
    expect(grepArg).toMatch(/^CHECKPOINT\(#_694__\)$/)
    expect(grepCall?.args).toContain('-F')
  })

  it('falls back to .claude/.task-id when taskId not provided', () => {
    writeFileSync(join(dir, '.claude', '.task-id'), '#777\n')
    writeBacklog({ taskDir: dir, taskId: '#777', content: 'autoresolved\n' })
    const { runner } = makeRunner([{ stdout: '' }, { stdout: '' }])
    const out = captureStdout(() => runTaskRecover({ dir, runner }))
    expect(out).toMatch(/autoresolved/)
  })

  it('emits fallback footer instructing MCP recovery', () => {
    const { runner } = makeRunner([{ stdout: '' }, { stdout: '' }])
    const out = captureStdout(() => runTaskRecover({ dir, taskId: '#x', runner }))
    expect(out).toMatch(/MCP|manual/i)
  })
})

/* ──────────────────────  #695 — plan-review gate  ────────────────────── */

function writeLatestPass(dir: string, taskId: string, planDigest: string): void {
  const sanit = taskId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64) || 'unknown'
  const evDir = join(dir, '.arbiter', 'evidence', 'plan-review', sanit)
  mkdirSync(evDir, { recursive: true })
  const latest = {
    verdict: 'PASS',
    ts: new Date().toISOString(),
    runDir: join(evDir, 'run-fake'),
    planDigest,
    tier: 'XS',
    totalInvocations: 1,
  }
  writeFileSync(join(evDir, 'latest.json'), JSON.stringify(latest, null, 2))
}

function plantEnableFile(dir: string): void {
  mkdirSync(join(dir, '.arbiter'), { recursive: true })
  writeFileSync(join(dir, '.arbiter', 'plan-review.enabled'), '')
}

describe('requirePlanReviewPass (#695)', () => {
  let dir: string
  beforeEach(() => {
    dir = createTestProject()
  })
  afterEach(() => cleanupTestProject(dir))

  it('returns ok:false when latest.json missing', () => {
    const r = requirePlanReviewPass({ dir, taskId: '#1' })
    expect(r.ok).toBe(false)
    expect(r.reason).toMatch(/no plan-review evidence/i)
  })

  it('returns ok:true when latest.json PASS and no planContent (digest skipped)', () => {
    writeLatestPass(dir, '#1', 'abc')
    const r = requirePlanReviewPass({ dir, taskId: '#1' })
    expect(r.ok).toBe(true)
  })

  it('returns ok:false on digest mismatch', () => {
    writeLatestPass(dir, '#1', 'abc')
    const r = requirePlanReviewPass({ dir, taskId: '#1', planContent: 'other' })
    expect(r.ok).toBe(false)
    expect(r.reason).toMatch(/plan changed/i)
  })

  it('returns ok:true on matching digest', () => {
    const plan = 'plan body'
    const digest = createHash('sha256').update(plan).digest('hex')
    writeLatestPass(dir, '#1', digest)
    const r = requirePlanReviewPass({ dir, taskId: '#1', planContent: plan })
    expect(r.ok).toBe(true)
  })

  it('returns ok:false when verdict != PASS', () => {
    const sanit = '_1'
    const evDir = join(dir, '.arbiter', 'evidence', 'plan-review', sanit)
    mkdirSync(evDir, { recursive: true })
    writeFileSync(
      join(evDir, 'latest.json'),
      JSON.stringify({ verdict: 'WARN', ts: '', runDir: '', planDigest: 'x', tier: 'XS' }),
    )
    const r = requirePlanReviewPass({ dir, taskId: '#1' })
    expect(r.ok).toBe(false)
    expect(r.reason).toMatch(/WARN/)
  })
})

describe('runTaskAdvance — plan-review gate (#695)', () => {
  let dir: string
  let claudeDir: string

  beforeEach(() => {
    dir = createTestProject()
    claudeDir = join(dir, '.claude')
    mkdirSync(claudeDir, { recursive: true })
    writeFileSync(join(claudeDir, '.task-phase'), 'red-team-review\n')
  })
  afterEach(() => {
    cleanupTestProject(dir)
    delete process.env.ARBITER_SKIP_PLAN_REVIEW
    delete process.env.CI
  })

  it('without enable file → advance allowed (gate dormant)', () => {
    expect(() => runTaskAdvance({ to: 'implementation', dir })).not.toThrow()
  })

  it('with enable file + no evidence → BLOCKS with actionable message', () => {
    plantEnableFile(dir)
    writeFileSync(join(claudeDir, '.task-id'), '#777\n')
    expect(() => runTaskAdvance({ to: 'implementation', dir })).toThrow(
      /plan-review|--skip-plan-review|no plan-review evidence/i,
    )
  })

  it('with enable file + skipPlanReview extras → allows + writes bypass-<ts>.json + stderr WARNING', () => {
    plantEnableFile(dir)
    writeFileSync(join(claudeDir, '.task-id'), '#777\n')
    let err = ''
    const orig = process.stderr.write.bind(process.stderr)
    process.stderr.write = (chunk: string) => {
      err += chunk
      return true
    }
    try {
      expect(() =>
        runTaskAdvance({ to: 'implementation', dir, skipPlanReview: true }),
      ).not.toThrow()
    } finally {
      process.stderr.write = orig
    }
    expect(err).toMatch(/WARNING.*plan-review.*bypass/i)
    const bypassDir = join(dir, '.arbiter', 'evidence', 'plan-review', '_777')
    const files = readdirSync(bypassDir)
    expect(files.some((f) => f.startsWith('bypass-'))).toBe(true)
  })

  it('with enable file + ARBITER_SKIP_PLAN_REVIEW=1 (no CI) → allows + bypass record', () => {
    plantEnableFile(dir)
    writeFileSync(join(claudeDir, '.task-id'), '#7\n')
    process.env.ARBITER_SKIP_PLAN_REVIEW = '1'
    expect(() => runTaskAdvance({ to: 'implementation', dir })).not.toThrow()
  })

  it('with enable file + env bypass + CI=true → BLOCKS (CI refuses env bypass)', () => {
    plantEnableFile(dir)
    writeFileSync(join(claudeDir, '.task-id'), '#7\n')
    process.env.ARBITER_SKIP_PLAN_REVIEW = '1'
    process.env.CI = 'true'
    expect(() => runTaskAdvance({ to: 'implementation', dir })).toThrow(
      /plan-review|no plan-review evidence/i,
    )
  })

  it('with enable file + PASS latest.json (no planContent check) → allows', () => {
    plantEnableFile(dir)
    writeFileSync(join(claudeDir, '.task-id'), '#8\n')
    writeLatestPass(dir, '#8', 'somedigest')
    expect(() => runTaskAdvance({ to: 'implementation', dir })).not.toThrow()
  })

  it('with enable file + PASS latest.json + .task-plan present + STALE digest → BLOCKS', () => {
    plantEnableFile(dir)
    writeFileSync(join(claudeDir, '.task-id'), '#9\n')
    const planFile = join(dir, '.claude', 'plans', 'task-9.md')
    mkdirSync(join(dir, '.claude', 'plans'), { recursive: true })
    writeFileSync(planFile, 'current plan body')
    writeFileSync(join(claudeDir, '.task-plan'), planFile + '\n')
    writeLatestPass(dir, '#9', 'STALEDIGEST')
    expect(() => runTaskAdvance({ to: 'implementation', dir })).toThrow(/plan changed/i)
  })

  it('with enable file + PASS latest.json + .task-plan + matching digest → allows', () => {
    plantEnableFile(dir)
    writeFileSync(join(claudeDir, '.task-id'), '#10\n')
    const planFile = join(dir, '.claude', 'plans', 'task-10.md')
    mkdirSync(join(dir, '.claude', 'plans'), { recursive: true })
    writeFileSync(planFile, 'current plan body')
    writeFileSync(join(claudeDir, '.task-plan'), planFile + '\n')
    const d = createHash('sha256').update('current plan body').digest('hex')
    writeLatestPass(dir, '#10', d)
    expect(() => runTaskAdvance({ to: 'implementation', dir })).not.toThrow()
  })

  it('gate only fires on target=implementation (other targets unaffected)', () => {
    plantEnableFile(dir)
    writeFileSync(join(claudeDir, '.task-phase'), 'plan\n')
    expect(() => runTaskAdvance({ to: 'red-team-review', dir })).not.toThrow()
  })
})
