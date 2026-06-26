import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createHash } from 'node:crypto'
import {
  mkdirSync,
  mkdtempSync,
  writeFileSync,
  readFileSync,
  rmSync,
  existsSync,
  readdirSync,
  chmodSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  buildReviewPrompt,
  dispatchClaudeAgent,
  dispatchPlanReview,
  extractFirstJsonObject,
  parseAgentReport,
  sanitizeTaskId,
  type SubagentDispatcher,
} from '../../src/review/dispatch.js'
import { dispatchAgents } from '../../src/review/multi-agent.js'

const PASS_PLAN = `# Plan: feature
## Scope
- src/feature.ts
## Test plan
- write failing tests first
## Risk
- might break X
`

function withTempDir(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'arbiter-review-'))
  writeFileSync(join(dir, 'AGENTS.md'), '# Test AGENTS.md\n')
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

describe('buildReviewPrompt (#235)', () => {
  let env: ReturnType<typeof withTempDir>
  beforeEach(() => {
    env = withTempDir()
  })
  afterEach(() => env.cleanup())

  it('wraps plan content in an XML envelope with SSOT digest', () => {
    const prompt = buildReviewPrompt({
      planContent: PASS_PLAN,
      dir: env.dir,
      tier: 'S',
    })
    expect(prompt).toContain('<review')
    expect(prompt).toContain('</review>')
    expect(prompt).toMatch(/<ssotDigest>[0-9a-f]{64}<\/ssotDigest>/)
    expect(prompt).toContain('<plan>')
    expect(prompt).toContain('<tier>S</tier>')
    expect(prompt).toContain('## Scope')
  })

  it('changes digest when AGENTS.md changes', () => {
    const a = buildReviewPrompt({ planContent: PASS_PLAN, dir: env.dir, tier: 'S' })
    writeFileSync(join(env.dir, 'AGENTS.md'), '# Different content\n')
    const b = buildReviewPrompt({ planContent: PASS_PLAN, dir: env.dir, tier: 'S' })
    expect(a).not.toBe(b)
  })
})

describe('dispatchPlanReview (#235, #695)', () => {
  let env: ReturnType<typeof withTempDir>
  beforeEach(() => {
    env = withTempDir()
  })
  afterEach(() => {
    env.cleanup()
    delete process.env.ARBITER_PLAN_REVIEW_OPTIONAL
  })

  function fakeDispatcher(verdict: 'PASS' | 'WARN' | 'FAIL'): SubagentDispatcher {
    return { run: () => ({ stdout: `verdict: ${verdict}\n`, exitCode: 0 }) }
  }

  function countingDispatcher(verdicts: Array<'PASS' | 'WARN' | 'FAIL'>): {
    dispatcher: SubagentDispatcher
    calls: { count: number }
  } {
    const state = { count: 0 }
    const d: SubagentDispatcher = {
      run: () => {
        const v = verdicts[state.count] ?? verdicts[verdicts.length - 1] ?? 'PASS'
        state.count++
        return { stdout: `verdict: ${v}\n`, exitCode: 0 }
      },
    }
    return { dispatcher: d, calls: state }
  }

  // ─── XS tier (1 invocation per cycle — pinned for clarity) ───

  it('XS tier: PASS verdict → exit 0, totalInvocations=1, attempts=1', () => {
    const result = dispatchPlanReview({
      planContent: PASS_PLAN,
      dir: env.dir,
      tier: 'XS',
      dispatcher: fakeDispatcher('PASS'),
    })
    expect(result.verdict).toBe('PASS')
    expect(result.exitCode).toBe(0)
    expect(result.totalInvocations).toBe(1)
    expect(result.attempts).toBe(1)
  })

  it('XS tier: WARN → up to 2 revise cycles → final WARN if always WARN', () => {
    const { dispatcher, calls } = countingDispatcher(['WARN', 'WARN', 'WARN'])
    const result = dispatchPlanReview({
      planContent: PASS_PLAN,
      dir: env.dir,
      tier: 'XS',
      dispatcher,
    })
    expect(calls.count).toBe(3)
    expect(result.attempts).toBe(3)
    expect(result.totalInvocations).toBe(3)
    expect(result.verdict).toBe('FAIL')
    expect(result.exitCode).toBe(2)
  })

  it('XS tier: FAIL fails fast (no revise)', () => {
    const { dispatcher, calls } = countingDispatcher(['FAIL'])
    dispatchPlanReview({
      planContent: PASS_PLAN,
      dir: env.dir,
      tier: 'XS',
      dispatcher,
    })
    expect(calls.count).toBe(1)
  })

  it('XS tier: WARN-then-PASS revises and settles', () => {
    const { dispatcher, calls } = countingDispatcher(['WARN', 'PASS'])
    const result = dispatchPlanReview({
      planContent: PASS_PLAN,
      dir: env.dir,
      tier: 'XS',
      dispatcher,
    })
    expect(calls.count).toBe(2)
    expect(result.verdict).toBe('PASS')
    expect(result.attempts).toBe(2)
  })

  // ─── S tier (3 invocations per cycle) ───

  it('S tier: 3 invocations per cycle, all PASS → final PASS', () => {
    const { dispatcher, calls } = countingDispatcher(['PASS', 'PASS', 'PASS'])
    const result = dispatchPlanReview({
      planContent: PASS_PLAN,
      dir: env.dir,
      tier: 'S',
      dispatcher,
    })
    expect(calls.count).toBe(3)
    expect(result.verdict).toBe('PASS')
    expect(result.totalInvocations).toBe(3)
    expect(result.attempts).toBe(1)
  })

  it('S tier: ANY pass returns FAIL → final FAIL, no revise', () => {
    const { dispatcher, calls } = countingDispatcher(['PASS', 'FAIL', 'PASS'])
    const result = dispatchPlanReview({
      planContent: PASS_PLAN,
      dir: env.dir,
      tier: 'S',
      dispatcher,
    })
    expect(calls.count).toBe(3)
    expect(result.verdict).toBe('FAIL')
    expect(result.attempts).toBe(1)
  })

  it('S tier: cycle WARN (mixed) → revise; cycle 2 all PASS → final PASS', () => {
    const { dispatcher, calls } = countingDispatcher([
      'PASS',
      'WARN',
      'PASS',
      'PASS',
      'PASS',
      'PASS',
    ])
    const result = dispatchPlanReview({
      planContent: PASS_PLAN,
      dir: env.dir,
      tier: 'S',
      dispatcher,
    })
    expect(calls.count).toBe(6)
    expect(result.verdict).toBe('PASS')
    expect(result.attempts).toBe(2)
    expect(result.totalInvocations).toBe(6)
  })

  // ─── Standard tier (5 invocations per cycle) ───

  it('Standard tier: 5 invocations per cycle (all PASS)', () => {
    const { dispatcher, calls } = countingDispatcher(['PASS', 'PASS', 'PASS', 'PASS', 'PASS'])
    const result = dispatchPlanReview({
      planContent: PASS_PLAN,
      dir: env.dir,
      tier: 'Standard',
      dispatcher,
    })
    expect(calls.count).toBe(5)
    expect(result.totalInvocations).toBe(5)
    expect(result.attempts).toBe(1)
    expect(result.verdict).toBe('PASS')
  })

  it('Standard tier: max revises exhausted (15 invocations, all WARN) → final FAIL', () => {
    const { dispatcher, calls } = countingDispatcher(Array(15).fill('WARN'))
    const result = dispatchPlanReview({
      planContent: PASS_PLAN,
      dir: env.dir,
      tier: 'Standard',
      dispatcher,
    })
    expect(calls.count).toBe(15)
    expect(result.attempts).toBe(3)
    expect(result.totalInvocations).toBe(15)
    expect(result.verdict).toBe('FAIL')
    expect(result.reason).toMatch(/max revis/i)
  })

  // ─── Per-pass evidence layout ───

  it('writes pass-<N>.json under <evidenceDir>/run-<ts>/ and latest.json pointer', () => {
    const result = dispatchPlanReview({
      planContent: PASS_PLAN,
      dir: env.dir,
      tier: 'S',
      taskId: 'demo',
      dispatcher: fakeDispatcher('PASS'),
    })
    expect(result.evidenceDir).toMatch(/\.arbiter\/evidence\/plan-review\/demo$/)
    expect(result.runDir).toMatch(/\/run-/)
    const passFiles = readdirSync(result.runDir).filter((f) => f.startsWith('pass-'))
    expect(passFiles.sort()).toEqual(['pass-1.json', 'pass-2.json', 'pass-3.json'])
    for (const f of passFiles) {
      const parsed = JSON.parse(readFileSync(join(result.runDir, f), 'utf-8')) as Record<
        string,
        unknown
      >
      expect(parsed.verdict).toBe('PASS')
      expect(typeof parsed.pass).toBe('number')
      expect(typeof parsed.ts).toBe('string')
    }
    const latestRaw = readFileSync(result.latestPath, 'utf-8')
    const latest = JSON.parse(latestRaw) as Record<string, unknown>
    expect(latest.verdict).toBe('PASS')
    expect(latest.tier).toBe('S')
    expect(latest.totalInvocations).toBe(3)
    expect(typeof latest.runDir).toBe('string')
    expect(typeof latest.planDigest).toBe('string')
    expect((latest.planDigest as string).length).toBe(64)
    // #1212: branch+sha stamped for Stop-hook evidence correlation
    expect(typeof latest.branch).toBe('string')
    expect(typeof latest.sha).toBe('string')
  })

  it('latest.json.planDigest matches SHA-256 of planContent', () => {
    const expected = createHash('sha256').update(PASS_PLAN).digest('hex')
    const result = dispatchPlanReview({
      planContent: PASS_PLAN,
      dir: env.dir,
      tier: 'XS',
      taskId: 'digest-check',
      dispatcher: fakeDispatcher('PASS'),
    })
    const latest = JSON.parse(readFileSync(result.latestPath, 'utf-8')) as { planDigest: string }
    expect(latest.planDigest).toBe(expected)
  })

  it('taskId sanitization: # and special chars stripped from path', () => {
    const result = dispatchPlanReview({
      planContent: PASS_PLAN,
      dir: env.dir,
      tier: 'XS',
      taskId: '#694',
      dispatcher: fakeDispatcher('PASS'),
    })
    expect(result.evidenceDir).toContain('/_694')
    expect(result.evidenceDir).not.toContain('#')
  })

  it('taskId with .. and / sanitized — no path traversal', () => {
    const result = dispatchPlanReview({
      planContent: PASS_PLAN,
      dir: env.dir,
      tier: 'XS',
      taskId: '../../etc/passwd',
      dispatcher: fakeDispatcher('PASS'),
    })
    expect(result.evidenceDir).not.toContain('..')
    expect(result.evidenceDir).toMatch(/_+etc_passwd$/)
  })

  it('falls back taskId to "unknown" when not provided and no .claude/.task-id', () => {
    const result = dispatchPlanReview({
      planContent: PASS_PLAN,
      dir: env.dir,
      tier: 'XS',
      dispatcher: fakeDispatcher('PASS'),
    })
    expect(result.evidenceDir).toMatch(/\/unknown$/)
  })

  it('reads taskId from .claude/.task-id when not in opts', () => {
    const cl = join(env.dir, '.claude')
    mkdirSync(cl, { recursive: true })
    writeFileSync(join(cl, '.task-id'), '#999\n')
    const result = dispatchPlanReview({
      planContent: PASS_PLAN,
      dir: env.dir,
      tier: 'XS',
      dispatcher: fakeDispatcher('PASS'),
    })
    expect(result.evidenceDir).toMatch(/_999$/)
  })

  // ─── prompt persistence ───

  it('persists the XML prompt under .evidence/review-<ts>/plan-review-prompt.txt', () => {
    const result = dispatchPlanReview({
      planContent: PASS_PLAN,
      dir: env.dir,
      tier: 'XS',
      dispatcher: fakeDispatcher('PASS'),
    })
    expect(existsSync(result.promptPath)).toBe(true)
    const persisted = readFileSync(result.promptPath, 'utf-8')
    expect(persisted).toContain('<review')
  })

  // ─── claude CLI missing handling ───
  // The genuine "claude not installed" skip is signalled by the
  // dispatcherUnavailable transport flag, NOT by a `verdict: ERROR` token in
  // stdout (a model could print that, or a crash could synthesise it). #1577.

  it('dispatcher unavailable (claude not installed) → final FAIL with "claude required" reason', () => {
    const unavailableDisp: SubagentDispatcher = {
      run: () => ({ stdout: '', exitCode: 127, dispatcherUnavailable: true }),
    }
    const result = dispatchPlanReview({
      planContent: PASS_PLAN,
      dir: env.dir,
      tier: 'XS',
      dispatcher: unavailableDisp,
    })
    expect(result.verdict).toBe('FAIL')
    expect(result.reason).toMatch(/claude/i)
  })

  it('ARBITER_PLAN_REVIEW_OPTIONAL=1 converts dispatcher-unavailable → PASS (SKIPPED)', () => {
    process.env.ARBITER_PLAN_REVIEW_OPTIONAL = '1'
    const unavailableDisp: SubagentDispatcher = {
      run: () => ({ stdout: '', exitCode: 127, dispatcherUnavailable: true }),
    }
    const result = dispatchPlanReview({
      planContent: PASS_PLAN,
      dir: env.dir,
      tier: 'XS',
      dispatcher: unavailableDisp,
    })
    expect(result.verdict).toBe('PASS')
    expect(result.exitCode).toBe(0)
  })

  // ─── #1577: verdict parser must take the LAST token (rubric-echo fake-green) ───

  it('rubric echo followed by real FAIL → FAIL (last token wins, not first PASS)', () => {
    // The prompt embeds the rubric ("verdict: PASS" … "verdict: FAIL"); a model
    // that restates it before its conclusion puts PASS first in stdout. The
    // old first-token parser scored PASS — a prompt-echo fake-green.
    const echoDisp: SubagentDispatcher = {
      run: () => ({
        stdout:
          'The rubric says verdict: PASS — implementable; verdict: WARN — fixable gaps; ' +
          'verdict: FAIL — invariant violation.\nMy decision is:\nverdict: FAIL\n',
        exitCode: 0,
      }),
    }
    const result = dispatchPlanReview({
      planContent: PASS_PLAN,
      dir: env.dir,
      tier: 'XS',
      dispatcher: echoDisp,
    })
    expect(result.verdict).toBe('FAIL')
  })

  // ─── #1577: a model printing "verdict: ERROR" is NOT the skip case ───

  it('model emits "verdict: ERROR" under OPTIONAL → not laundered to PASS', () => {
    process.env.ARBITER_PLAN_REVIEW_OPTIONAL = '1'
    const erroryDisp: SubagentDispatcher = {
      run: () => ({ stdout: 'verdict: ERROR could not parse the plan\n', exitCode: 0 }),
    }
    const result = dispatchPlanReview({
      planContent: PASS_PLAN,
      dir: env.dir,
      tier: 'XS',
      dispatcher: erroryDisp,
    })
    expect(result.verdict).not.toBe('PASS')
  })

  // ─── #1577: a dispatcher CRASH finalises FAIL even under OPTIONAL ───

  it('dispatcher crash under OPTIONAL → FAIL (crash ≠ claude-missing skip)', () => {
    process.env.ARBITER_PLAN_REVIEW_OPTIONAL = '1'
    const crashDisp: SubagentDispatcher = {
      run: () => {
        throw new Error('claude OOM killed mid-stream')
      },
    }
    const result = dispatchPlanReview({
      planContent: PASS_PLAN,
      dir: env.dir,
      tier: 'XS',
      dispatcher: crashDisp,
    })
    expect(result.verdict).toBe('FAIL')
    expect(result.reason).toMatch(/crash/i)
  })
})

describe('sanitizeTaskId (#694)', () => {
  it('strips # prefix', () => {
    expect(sanitizeTaskId('#694')).toBe('_694')
  })
  it('strips slashes and dots', () => {
    expect(sanitizeTaskId('../etc/passwd')).toBe('___etc_passwd')
  })
  it('strips regex metacharacters', () => {
    expect(sanitizeTaskId('a.b*c')).toBe('a_b_c')
  })
  it('returns "unknown" for empty', () => {
    expect(sanitizeTaskId('')).toBe('unknown')
  })
  it('preserves safe id', () => {
    expect(sanitizeTaskId('safe_id-1')).toBe('safe_id-1')
  })
  it('caps length at 64', () => {
    expect(sanitizeTaskId('a'.repeat(100)).length).toBe(64)
  })
  it('strips unicode', () => {
    expect(sanitizeTaskId('unicodeé')).toBe('unicode_')
  })
})

describe('extractFirstJsonObject (W-1, brace-depth scanner)', () => {
  it('returns null when no { is present', () => {
    expect(extractFirstJsonObject('no braces here')).toBeNull()
  })
  it('extracts a simple balanced object', () => {
    expect(extractFirstJsonObject('{"a":1}')).toBe('{"a":1}')
  })
  it('stops at the first balanced close (not last) when prose follows', () => {
    const s = '{"findings":[]} blah blah } more prose'
    expect(extractFirstJsonObject(s)).toBe('{"findings":[]}')
  })
  it('handles nested objects correctly', () => {
    const s = '{"a":{"b":{"c":1}}, "d":[1,2]}'
    expect(extractFirstJsonObject(`prefix ${s} suffix`)).toBe(s)
  })
  it('ignores } characters inside string literals', () => {
    const s = '{"msg":"closing }"}'
    expect(extractFirstJsonObject(s)).toBe(s)
  })
  it('handles escaped quotes inside strings', () => {
    const s = '{"msg":"escaped \\" inside"}'
    expect(extractFirstJsonObject(s)).toBe(s)
  })
  it('returns null when braces are unbalanced (no closing brace)', () => {
    expect(extractFirstJsonObject('{"a":1')).toBeNull()
  })
})

describe('parseAgentReport (W-6, direct tests)', () => {
  it('parses a clean envelope', () => {
    const r = parseAgentReport('{"findings":[],"passed":true}', 'bugs')
    expect(r.passed).toBe(true)
    expect(r.findings).toEqual([])
  })
  it('parses a finding correctly', () => {
    const r = parseAgentReport(
      '{"findings":[{"severity":"warning","agent":"bugs","message":"x"}],"passed":false}',
      'bugs',
    )
    expect(r.findings).toHaveLength(1)
    expect(r.findings[0]?.severity).toBe('warning')
  })
  it('tolerates surrounding prose (brace-depth scan)', () => {
    const r = parseAgentReport(
      'Some prose here.\n{"findings":[],"passed":true}\nMore prose.',
      'bugs',
    )
    expect(r.passed).toBe(true)
  })
  it('throws on malformed JSON', () => {
    expect(() => parseAgentReport('{not json}', 'bugs')).toThrow()
  })
  it('throws when payload is not an object', () => {
    expect(() => parseAgentReport('[]', 'bugs')).toThrow(/non-object payload/)
  })
  it('throws when findings is missing', () => {
    expect(() => parseAgentReport('{"passed":true}', 'bugs')).toThrow(/missing "findings" array/)
  })
  it('throws on malformed finding (bad severity)', () => {
    expect(() =>
      parseAgentReport(
        '{"findings":[{"severity":"oops","agent":"bugs","message":"x"}],"passed":false}',
        'bugs',
      ),
    ).toThrow(/malformed finding/)
  })
  it('throws on malformed finding (missing message)', () => {
    expect(() =>
      parseAgentReport('{"findings":[{"severity":"note","agent":"bugs"}],"passed":false}', 'bugs'),
    ).toThrow(/malformed finding/)
  })
})

describe('dispatchClaudeAgent concurrency (#1514)', () => {
  let dir: string
  let fakeCli: string
  const SLEEP_MS = 400

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'arbiter-agent-cc-'))
    // Fake `claude`: ignores its args, sleeps, then emits a valid agent report.
    // A spawnSync-based dispatcher would serialize these sleeps; spawn does not.
    fakeCli = join(dir, 'fake-claude.mjs')
    writeFileSync(
      fakeCli,
      [
        '#!/usr/bin/env node',
        `setTimeout(() => {`,
        `  process.stdout.write(JSON.stringify({ findings: [], passed: true }))`,
        `}, ${SLEEP_MS})`,
        '',
      ].join('\n'),
    )
    chmodSync(fakeCli, 0o755)
  })

  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('dispatches N agents concurrently — wall clock ≈ MAX(agents), not SUM', async () => {
    const dispatch = dispatchClaudeAgent({ cmd: fakeCli, timeoutMs: 30_000 })
    const prompts = [
      { name: 'bugs', prompt: '<reviewAgent>a</reviewAgent>' },
      { name: 'type-safety', prompt: '<reviewAgent>b</reviewAgent>' },
      { name: 'silent-failure-hunter', prompt: '<reviewAgent>c</reviewAgent>' },
    ]
    const start = Date.now()
    const results = await dispatchAgents(prompts, { dispatch })
    const elapsed = Date.now() - start

    // All agents succeeded (no dispatch failures folded into blockers).
    expect(results.map((r) => r.agent).sort()).toEqual([
      'bugs',
      'silent-failure-hunter',
      'type-safety',
    ])
    expect(results.every((r) => r.passed)).toBe(true)

    // Serial cost would be 3 * SLEEP_MS = 1200ms. Concurrent is ~SLEEP_MS.
    // Ceiling at 2x a single sleep leaves ample headroom while still failing
    // hard on the old sequential spawnSync behaviour.
    expect(elapsed).toBeLessThan(2 * SLEEP_MS)
  })
})
