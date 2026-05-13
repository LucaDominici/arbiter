import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  buildReviewPrompt,
  dispatchPlanReview,
  extractFirstJsonObject,
  parseAgentReport,
  type SubagentDispatcher,
} from '../../src/review/dispatch.js'

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
  // AGENTS.md must exist for SSOT digest
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
    expect(prompt).toContain('<ssotDigest>')
    expect(prompt).toMatch(/<ssotDigest>[0-9a-f]{64}<\/ssotDigest>/)
    expect(prompt).toContain('<plan>')
    expect(prompt).toContain('<tier>S</tier>')
    expect(prompt).toContain('## Scope')
  })

  it('changes digest when AGENTS.md changes', () => {
    const a = buildReviewPrompt({
      planContent: PASS_PLAN,
      dir: env.dir,
      tier: 'S',
    })
    writeFileSync(join(env.dir, 'AGENTS.md'), '# Different content\n')
    const b = buildReviewPrompt({
      planContent: PASS_PLAN,
      dir: env.dir,
      tier: 'S',
    })
    expect(a).not.toBe(b)
  })
})

describe('dispatchPlanReview (#235)', () => {
  let env: ReturnType<typeof withTempDir>
  beforeEach(() => {
    env = withTempDir()
  })
  afterEach(() => env.cleanup())

  function fakeDispatcher(verdict: 'PASS' | 'WARN' | 'FAIL'): SubagentDispatcher {
    return {
      run: () => ({ stdout: `verdict: ${verdict}\n`, exitCode: 0 }),
    }
  }

  it('returns exit code 0 when subagent reports PASS', () => {
    const result = dispatchPlanReview({
      planContent: PASS_PLAN,
      dir: env.dir,
      tier: 'S',
      dispatcher: fakeDispatcher('PASS'),
    })
    expect(result.verdict).toBe('PASS')
    expect(result.exitCode).toBe(0)
  })

  it('returns exit code 1 when subagent reports WARN', () => {
    const result = dispatchPlanReview({
      planContent: PASS_PLAN,
      dir: env.dir,
      tier: 'S',
      dispatcher: fakeDispatcher('WARN'),
    })
    expect(result.verdict).toBe('WARN')
    expect(result.exitCode).toBe(1)
  })

  it('returns exit code 2 when subagent reports FAIL', () => {
    const result = dispatchPlanReview({
      planContent: PASS_PLAN,
      dir: env.dir,
      tier: 'S',
      dispatcher: fakeDispatcher('FAIL'),
    })
    expect(result.verdict).toBe('FAIL')
    expect(result.exitCode).toBe(2)
  })

  it('persists the XML prompt under .evidence/review-<ts>/plan-review-prompt.txt', () => {
    const result = dispatchPlanReview({
      planContent: PASS_PLAN,
      dir: env.dir,
      tier: 'S',
      dispatcher: fakeDispatcher('PASS'),
    })
    expect(existsSync(result.promptPath)).toBe(true)
    const persisted = readFileSync(result.promptPath, 'utf-8')
    expect(persisted).toContain('<review')
    expect(result.promptPath).toMatch(/\.evidence\/review-[^/]+\/plan-review-prompt\.txt$/)
  })

  it('retries up to 2 revise-cycles on WARN before settling', () => {
    let calls = 0
    const dispatcher: SubagentDispatcher = {
      run: () => {
        calls++
        // 1st + 2nd call WARN; allow up to 2 revise cycles → 3 total invocations
        if (calls < 3) return { stdout: 'verdict: WARN\n', exitCode: 0 }
        return { stdout: 'verdict: PASS\n', exitCode: 0 }
      },
    }
    const result = dispatchPlanReview({
      planContent: PASS_PLAN,
      dir: env.dir,
      tier: 'S',
      dispatcher,
    })
    expect(calls).toBe(3)
    expect(result.verdict).toBe('PASS')
    expect(result.exitCode).toBe(0)
  })

  it('caps revise-cycles at 2 (3 total invocations) even if always WARN', () => {
    let calls = 0
    const dispatcher: SubagentDispatcher = {
      run: () => {
        calls++
        return { stdout: 'verdict: WARN\n', exitCode: 0 }
      },
    }
    const result = dispatchPlanReview({
      planContent: PASS_PLAN,
      dir: env.dir,
      tier: 'S',
      dispatcher,
    })
    expect(calls).toBe(3)
    expect(result.verdict).toBe('WARN')
    expect(result.exitCode).toBe(1)
  })

  it('fails fast (no retry) on FAIL verdict', () => {
    let calls = 0
    const dispatcher: SubagentDispatcher = {
      run: () => {
        calls++
        return { stdout: 'verdict: FAIL\n', exitCode: 0 }
      },
    }
    dispatchPlanReview({
      planContent: PASS_PLAN,
      dir: env.dir,
      tier: 'S',
      dispatcher,
    })
    expect(calls).toBe(1)
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
    // Greedy regex would consume through the last } including the prose.
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
    // JSON.parse succeeds on "[]" but it's an array → non-object payload
    // brace-extractor will not match "[]" so the trimmed array passes to JSON.parse
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
