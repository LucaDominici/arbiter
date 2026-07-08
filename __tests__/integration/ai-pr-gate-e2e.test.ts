// SPDX-License-Identifier: Apache-2.0
// F3: AI-PR gate end-to-end test (#890)
// Verifies: bot-authored PR fails _ai-draft-check until approved-by-human label applied
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { generateGithub } from '../../src/generators/github.js'
import { makeConfig } from '../helpers.js'

// Simulate the _ai-draft-check workflow logic:
// Returns true (check passes) if PR is not bot-authored, is the exempt
// dependabot[bot] account, OR has the approved-by-human label.
// Returns false (check fails) if PR is bot-authored (non-exempt) AND lacks
// the approved-by-human label.
function simulateAiDraftCheck(
  prAuthorType: 'Bot' | 'User',
  labels: string[],
  prAuthorLogin = 'some-ai-agent[bot]',
): boolean {
  const isBot = prAuthorType === 'Bot'
  const isDependabot = prAuthorLogin === 'dependabot[bot]'
  const hasApproval = labels.includes('approved-by-human')
  if (isBot && !isDependabot && !hasApproval) {
    return false // check fails
  }
  return true // check passes
}

// Simulate the _label-on-approve workflow logic:
// Returns the updated labels after a review is approved by a human.
function simulateLabelOnApprove(
  reviewerType: 'Bot' | 'User',
  reviewerLogin: string,
  prAuthorLogin: string,
  reviewState: 'approved' | 'changes_requested' | 'commented',
  existingLabels: string[],
): string[] {
  const isHuman = reviewerType === 'User'
  const isDifferentUser = reviewerLogin !== prAuthorLogin
  const isApproved = reviewState === 'approved'
  if (isHuman && isDifferentUser && isApproved) {
    return [...new Set([...existingLabels, 'approved-by-human'])]
  }
  return existingLabels
}

describe('AI-PR gate — bot author detection (F3, #890)', () => {
  it('bot-authored PR fails the check without approved-by-human label', () => {
    const passes = simulateAiDraftCheck('Bot', [])
    expect(passes).toBe(false)
  })

  it('bot-authored PR passes after approved-by-human label is applied', () => {
    const passes = simulateAiDraftCheck('Bot', ['approved-by-human'])
    expect(passes).toBe(true)
  })

  it('human-authored PR passes even without approved-by-human label', () => {
    const passes = simulateAiDraftCheck('User', [])
    expect(passes).toBe(true)
  })

  it('human-authored PR with approved-by-human label also passes', () => {
    const passes = simulateAiDraftCheck('User', ['approved-by-human'])
    expect(passes).toBe(true)
  })

  it('dependabot[bot] PR passes without the approved-by-human label (exempt, not security-relevant noise)', () => {
    const passes = simulateAiDraftCheck('Bot', [], 'dependabot[bot]')
    expect(passes).toBe(true)
  })

  it('non-dependabot bot-authored PR still fails without the label (INV-91 semantics intact for AI agents)', () => {
    const passes = simulateAiDraftCheck('Bot', [], 'some-ai-agent[bot]')
    expect(passes).toBe(false)
  })
})

describe('label-on-approve — idempotency and human check (F3, #890)', () => {
  it('human reviewer approving adds approved-by-human label', () => {
    const labels = simulateLabelOnApprove('User', 'alice', 'bot-user', 'approved', [])
    expect(labels).toContain('approved-by-human')
  })

  it('applying the label twice is idempotent', () => {
    const labels1 = simulateLabelOnApprove('User', 'alice', 'bot-user', 'approved', [])
    const labels2 = simulateLabelOnApprove('User', 'alice', 'bot-user', 'approved', labels1)
    expect(labels2.filter((l) => l === 'approved-by-human').length).toBe(1)
  })

  it('bot reviewer approval does not add the label', () => {
    const labels = simulateLabelOnApprove('Bot', 'github-actions[bot]', 'author', 'approved', [])
    expect(labels).not.toContain('approved-by-human')
  })

  it('self-review does not add the label', () => {
    const labels = simulateLabelOnApprove('User', 'alice', 'alice', 'approved', [])
    expect(labels).not.toContain('approved-by-human')
  })

  it('changes_requested review does not add the label', () => {
    const labels = simulateLabelOnApprove('User', 'alice', 'bot-user', 'changes_requested', [])
    expect(labels).not.toContain('approved-by-human')
  })
})

describe('F3 — full flow: bot PR → human review → label → gate passes', () => {
  it('simulates complete flow: bot creates PR → fails → reviewer approves → label applied → passes', () => {
    // Step 1: Bot-authored PR, no labels
    const initialLabels: string[] = []
    expect(simulateAiDraftCheck('Bot', initialLabels)).toBe(false)

    // Step 2: Human reviewer approves
    const labelsAfterApproval = simulateLabelOnApprove(
      'User',
      'human-reviewer',
      'renovate[bot]',
      'approved',
      initialLabels,
    )
    expect(labelsAfterApproval).toContain('approved-by-human')

    // Step 3: Check now passes
    expect(simulateAiDraftCheck('Bot', labelsAfterApproval)).toBe(true)
  })
})

describe('_ai-draft-check workflow file generated by generator (F3, CANON-18)', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'arbiter-ai-draft-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('generates _ai-draft-check.yml for all governance levels', () => {
    for (const level of ['L1', 'L2', 'L3'] as const) {
      const levelDir = mkdtempSync(join(tmpdir(), `arbiter-ai-draft-${level}-`))
      try {
        generateGithub(makeConfig(levelDir, { governanceLevel: level }))
        const content = readFileSync(
          join(levelDir, '.github', 'workflows', '_ai-draft-check.yml'),
          'utf-8',
        )
        expect(content, `${level}: must check for bot author type`).toContain('user.type')
        expect(content, `${level}: must reference approved-by-human label`).toContain(
          'approved-by-human',
        )
      } finally {
        rmSync(levelDir, { recursive: true, force: true })
      }
    }
  })

  it('generates _label-on-approve.yml', () => {
    generateGithub(makeConfig(dir))
    const content = readFileSync(
      join(dir, '.github', 'workflows', '_label-on-approve.yml'),
      'utf-8',
    )
    expect(content).toContain('approved-by-human')
    expect(content).toContain('pull_request_review')
  })

  it('generates _pr-staleness.yml', () => {
    generateGithub(makeConfig(dir))
    const content = readFileSync(join(dir, '.github', 'workflows', '_pr-staleness.yml'), 'utf-8')
    expect(content).toContain('stale')
    expect(content).toContain('no-stale')
  })
})
