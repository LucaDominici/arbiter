// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from 'vitest'
import { buildToolingProposal, type ToolingProposalInput } from '../../src/kit/tooling-discovery.js'

function makeInput(overrides: Partial<ToolingProposalInput> = {}): ToolingProposalInput {
  return {
    stack: 'swift',
    toolchain: {
      linter: 'SwiftLint',
      formatter: 'swift-format',
      testRunner: 'XCTest',
      coverage: 'llvm-cov',
      security: 'mobsf',
    },
    evidence: {
      urls: ['https://github.com/realm/SwiftLint'],
      rationale: 'De-facto linter for Swift ecosystem',
    },
    ...overrides,
  }
}

describe('buildToolingProposal', () => {
  it('returns proposal with status=proposed', () => {
    const proposal = buildToolingProposal(makeInput())
    expect(proposal.status).toBe('proposed')
  })

  it('includes stack identifier', () => {
    const proposal = buildToolingProposal(makeInput({ stack: 'kotlin' }))
    expect(proposal.stack).toBe('kotlin')
  })

  it('includes toolchain fields from input', () => {
    const proposal = buildToolingProposal(makeInput())
    expect(proposal.toolchain.linter).toBe('SwiftLint')
    expect(proposal.toolchain.formatter).toBe('swift-format')
    expect(proposal.toolchain.testRunner).toBe('XCTest')
    expect(proposal.toolchain.coverage).toBe('llvm-cov')
    expect(proposal.toolchain.security).toBe('mobsf')
  })

  it('includes evidence from input', () => {
    const proposal = buildToolingProposal(makeInput())
    expect(proposal.evidence.rationale).toContain('Swift')
    expect(proposal.evidence.urls).toHaveLength(1)
  })

  it('sets generatedAt to an ISO date string', () => {
    const proposal = buildToolingProposal(makeInput())
    expect(proposal.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}/)
  })

  it('rejects empty stack string', () => {
    expect(() => buildToolingProposal(makeInput({ stack: '' }))).toThrow()
  })
})
