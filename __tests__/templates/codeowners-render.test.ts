import { describe, it, expect } from 'vitest'
import { renderTemplate } from '../../src/utils/render.js'
import { makeConfig } from '../helpers.js'

function cfg(overrides: Parameters<typeof makeConfig>[1] = {}) {
  return makeConfig('/tmp/test', {
    githubOwner: 'test-owner',
    ...overrides,
  }) as unknown as Record<string, unknown>
}

describe('CODEOWNERS.ejs render (#204)', () => {
  it('L1: contains wildcard owner, no EJS leaks', () => {
    const out = renderTemplate('root/CODEOWNERS.ejs', cfg({ governanceLevel: 'L1' }))
    expect(out).toContain('* @test-owner')
    expect(out).not.toContain('<%')
    expect(out).not.toContain('%>')
  })

  it('L1: does NOT contain .github/workflows/ or docs/SECURITY/', () => {
    const out = renderTemplate('root/CODEOWNERS.ejs', cfg({ governanceLevel: 'L1' }))
    expect(out).not.toContain('.github/workflows/')
    expect(out).not.toContain('docs/SECURITY/')
  })

  it('L2: contains .github/workflows/, .githooks/, AGENTS.md', () => {
    const out = renderTemplate('root/CODEOWNERS.ejs', cfg({ governanceLevel: 'L2' }))
    expect(out).toContain('.github/workflows/')
    expect(out).toContain('.githooks/')
    expect(out).toContain('AGENTS.md')
  })

  it('L2: does NOT contain docs/SECURITY/', () => {
    const out = renderTemplate('root/CODEOWNERS.ejs', cfg({ governanceLevel: 'L2' }))
    expect(out).not.toContain('docs/SECURITY/')
  })

  it('L2: no EJS leaks', () => {
    const out = renderTemplate('root/CODEOWNERS.ejs', cfg({ governanceLevel: 'L2' }))
    expect(out).not.toContain('<%')
    expect(out).not.toContain('%>')
  })

  it('L3: contains .github/workflows/, docs/SECURITY/, SECURE_CODING_CHECKLIST.md', () => {
    const out = renderTemplate('root/CODEOWNERS.ejs', cfg({ governanceLevel: 'L3' }))
    expect(out).toContain('.github/workflows/')
    expect(out).toContain('docs/SECURITY/')
    expect(out).toContain('SECURE_CODING_CHECKLIST.md')
  })

  it('L3: no EJS leaks', () => {
    const out = renderTemplate('root/CODEOWNERS.ejs', cfg({ governanceLevel: 'L3' }))
    expect(out).not.toContain('<%')
    expect(out).not.toContain('%>')
  })
})
