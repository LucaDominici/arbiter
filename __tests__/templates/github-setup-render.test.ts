// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from 'vitest'
import { renderTemplate } from '../../src/utils/render.js'
import { makeConfig } from '../helpers.js'

describe('setup-repo.sh.ejs rendering (CANON-04)', () => {
  it('renders label creation block', () => {
    const data = makeConfig('/tmp/test', {
      useGitHub: true,
      governanceLevel: 'L2',
    }) as unknown as Record<string, unknown>
    const content = renderTemplate('scripts/setup-repo.sh.ejs', data)
    expect(content).toContain('gh label create')
    expect(content).toContain('in-progress')
    expect(content).toContain('in-review')
  })

  it('renders branch protection block', () => {
    const data = makeConfig('/tmp/test', {
      useGitHub: true,
      governanceLevel: 'L2',
    }) as unknown as Record<string, unknown>
    const content = renderTemplate('scripts/setup-repo.sh.ejs', data)
    expect(content).toContain('branch protection')
    expect(content).toContain('allow_force_pushes')
  })

  it('renders set -e and gh CLI guard', () => {
    const data = makeConfig('/tmp/test', {
      useGitHub: true,
      governanceLevel: 'L2',
    }) as unknown as Record<string, unknown>
    const content = renderTemplate('scripts/setup-repo.sh.ejs', data)
    expect(content).toContain('set -e')
    expect(content).toContain('command -v gh')
  })

  it('script is idempotent — labels use --force flag', () => {
    const data = makeConfig('/tmp/test', {
      useGitHub: true,
      governanceLevel: 'L2',
    }) as unknown as Record<string, unknown>
    const content = renderTemplate('scripts/setup-repo.sh.ejs', data)
    expect(content).toContain('--force')
  })
})

// ─── apply-branch-protection.mjs.ejs ─────────────────────────────────────────

describe('apply-branch-protection.mjs.ejs rendering (CANON-04)', () => {
  function renderBP(overrides: Record<string, unknown> = {}) {
    return renderTemplate(
      'scripts/apply-branch-protection.mjs.ejs',
      makeConfig('/tmp/test', overrides as Parameters<typeof makeConfig>[1]) as unknown as Record<
        string,
        unknown
      >,
    )
  }

  it('ci-required and human-approval-required contexts present', () => {
    const content = renderBP({ governanceLevel: 'L2' })
    expect(content).toContain('ci-required')
    expect(content).toContain('human-approval-required')
  })

  it('allow_force_pushes: false present', () => {
    const content = renderBP({ governanceLevel: 'L2' })
    expect(content).toContain('allow_force_pushes')
  })

  it('L3: require_code_owner_reviews is true', () => {
    const content = renderBP({ governanceLevel: 'L3' })
    expect(content).toContain('require_code_owner_reviews: true')
  })

  it('L2: require_code_owner_reviews is false', () => {
    const content = renderBP({ governanceLevel: 'L2' })
    expect(content).toContain('require_code_owner_reviews: false')
  })

  it('L1: require_code_owner_reviews is false', () => {
    const content = renderBP({ governanceLevel: 'L1' })
    expect(content).toContain('require_code_owner_reviews: false')
  })

  it.each(['L1', 'L2', 'L3'] as const)('governance %s: no EJS tag leaks', (level) => {
    const content = renderBP({ governanceLevel: level })
    expect(content).not.toContain('<%')
    expect(content).not.toContain('%>')
  })

  it('uses spawnSync (not execSync) for command execution', () => {
    const content = renderBP({})
    expect(content).toContain('spawnSync')
    expect(content).not.toContain('execSync')
  })
})
