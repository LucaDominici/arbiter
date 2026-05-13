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
