import { describe, it, expect } from 'vitest'
import { renderTemplate } from '../../src/utils/render.js'
import { makeConfig } from '../helpers.js'

function renderCi(overrides: Record<string, unknown> = {}) {
  return renderTemplate(
    'github/workflows/01-pr-fast.yml.ejs',
    makeConfig('/tmp/test', overrides as Parameters<typeof makeConfig>[1]) as unknown as Record<
      string,
      unknown
    >,
  )
}

describe('01-pr-fast.yml.ejs lane awareness', () => {
  it('single-lane L1: no classify-changes job', () => {
    const rendered = renderCi({ lanes: [], governanceLevel: 'L1' })
    expect(rendered).not.toContain('classify-changes')
    expect(rendered).not.toContain('cross-stack-guard')
  })

  it('single-lane L2: classify-changes present, no cross-stack-guard (#161)', () => {
    const rendered = renderCi({ lanes: [], governanceLevel: 'L2' })
    expect(rendered).toContain('classify-changes')
    expect(rendered).not.toContain('cross-stack-guard')
  })

  it('single-lane L3: classify-changes still present (invariance)', () => {
    const rendered = renderCi({ lanes: [], governanceLevel: 'L3' })
    expect(rendered).toContain('classify-changes')
    expect(rendered).not.toContain('cross-stack-guard')
  })

  it('multi-lane L1: classify-changes promoted, cross-stack-guard present', () => {
    const rendered = renderCi({
      lanes: ['frontend', 'backend'],
      governanceLevel: 'L1',
    })
    expect(rendered).toContain('classify-changes')
    expect(rendered).toContain('cross-stack-guard')
  })

  it('multi-lane L2: classify-changes promoted, cross-stack-guard present', () => {
    const rendered = renderCi({
      lanes: ['frontend', 'backend'],
      governanceLevel: 'L2',
    })
    expect(rendered).toContain('classify-changes')
    expect(rendered).toContain('cross-stack-guard')
  })

  it('multi-lane L3: classify-changes + cross-stack-guard both present', () => {
    const rendered = renderCi({
      lanes: ['frontend', 'backend'],
      governanceLevel: 'L3',
    })
    expect(rendered).toContain('classify-changes')
    expect(rendered).toContain('cross-stack-guard')
  })

  it('multi-lane L3: cross-stack-guard hard-fails (exit 1)', () => {
    const rendered = renderCi({
      lanes: ['frontend', 'backend'],
      governanceLevel: 'L3',
    })
    expect(rendered).toContain('echo "::error::This PR touches both frontend and backend lanes')
    expect(rendered).toContain('exit 1')
    expect(rendered).not.toContain('actions/github-script')
  })

  it('multi-lane L1: cross-stack-guard uses advisory comment (github-script)', () => {
    const rendered = renderCi({
      lanes: ['frontend', 'backend'],
      governanceLevel: 'L1',
    })
    expect(rendered).toContain('actions/github-script')
    // cross-stack-guard step should be uses: not run: (no run-level exit 1)
    expect(rendered).toContain('github.rest.issues.createComment')
  })

  it('multi-lane L2: cross-stack-guard uses advisory comment (github-script)', () => {
    const rendered = renderCi({
      lanes: ['frontend', 'backend'],
      governanceLevel: 'L2',
    })
    expect(rendered).toContain('actions/github-script')
  })

  it('multi-lane: ci-required checks cross-stack-guard result', () => {
    const rendered = renderCi({
      lanes: ['frontend', 'backend'],
      governanceLevel: 'L3',
    })
    expect(rendered).toContain('needs.cross-stack-guard.result')
  })

  it('single-lane: ci-required does NOT check cross-stack-guard', () => {
    const rendered = renderCi({ lanes: [], governanceLevel: 'L3' })
    expect(rendered).not.toContain('needs.cross-stack-guard.result')
  })

  it('single-lane: byte-identical L3 output before and after lanes field present', () => {
    const withEmpty = renderCi({ lanes: [], governanceLevel: 'L3' })
    const withUndefined = renderTemplate('github/workflows/01-pr-fast.yml.ejs', {
      ...makeConfig('/tmp/test', { governanceLevel: 'L3' } as Parameters<typeof makeConfig>[1]),
      lanes: undefined,
    } as unknown as Record<string, unknown>)
    expect(withEmpty).toBe(withUndefined)
  })
})
