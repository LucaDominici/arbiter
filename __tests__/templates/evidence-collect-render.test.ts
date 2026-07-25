import { describe, it, expect } from 'vitest'
import { renderTemplate } from '../../src/utils/render.js'
import { makeConfig } from '../helpers.js'
import type { Language } from '../../src/wizard/types.js'

function render(language: Language = 'typescript'): string {
  const config = makeConfig('/tmp/test', {
    governanceLevel: 'L3',
    language,
    ...(language === 'go' ? { buildTool: 'go' } : {}),
  })
  return renderTemplate('scripts/evidence-collect.mjs.ejs', {
    ...(config as unknown as Record<string, unknown>),
    mutationThreshold: 80,
    coverageThreshold: 80,
  })
}

describe('evidence-collect.mjs.ejs render (#241)', () => {
  it('emits head_sha field in the summary object', () => {
    const out = render()
    expect(out).toContain('head_sha')
  })

  it('emits head_sha_short field in the summary object', () => {
    const out = render()
    expect(out).toContain('head_sha_short')
  })

  it('computes and embeds a canonical sha field', () => {
    const out = render()
    expect(out).toContain('computeSummarySha')
    expect(out).toContain('sha:')
  })

  it('uses git rev-parse HEAD (full SHA) for head_sha', () => {
    const out = render()
    expect(out).toMatch(/rev-parse.*HEAD/)
    expect(out).toContain('head_sha')
  })

  // ── G1b unit 7 (#1316): persist the stack so `arbiter verify` resolves the
  // signed language instead of falling back to detect (which can yield 'unknown'
  // and skip the matrix). The render context language is the source of truth.
  it('persists the stack field in SUMMARY.json (typescript)', () => {
    const out = render('typescript')
    expect(out).toContain("stack: 'typescript'")
  })

  // #2106 — covermode is part of Go's test-cache key, so a step pinning `atomic`
  // cannot reuse anything warmed by a default-covermode run of the same packages.
  // No generated workflow invokes this script (the `evidence-collect` JOB in
  // _nightly.yml/_monthly.yml writes a summary.txt inline and never calls it), so
  // it runs where an operator runs it: the same working tree as the gate, warm
  // cache. Statement coverage is identical between the modes; `atomic` is only
  // required under `-race`, which collects no coverage here.
  it('does not pin -covermode=atomic on the go coverage run', () => {
    expect(render('go')).not.toContain('-covermode=atomic')
  })

  it('still writes the coverage profile the go tool cover step reads', () => {
    const out = render('go')
    expect(out).toContain("'-coverprofile=.evidence/coverage.out'")
    expect(out).toContain("'-func=.evidence/coverage.out'")
  })

  it('persists the stack field in SUMMARY.json (go)', () => {
    const out = render('go')
    expect(out).toContain("stack: 'go'")
  })

  it('stack is part of summaryBody (covered by the SHA, before sha is appended)', () => {
    const out = render('go')
    const stackIdx = out.indexOf("stack: 'go'")
    const shaIdx = out.indexOf('const sha = computeSummarySha(summaryBody)')
    expect(stackIdx).toBeGreaterThan(0)
    expect(stackIdx).toBeLessThan(shaIdx)
  })
})
