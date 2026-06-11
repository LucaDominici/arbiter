// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from 'vitest'
import { renderTemplate } from '../../src/utils/render.js'
import { makeConfig } from '../helpers.js'

const SHIP_VARS = { shipLabel: 'ship', harnessCmd: 'claude' }
const dummyDir = '/tmp/arbiter-ship-render-test'

function baseData(overrides: Record<string, unknown>): Record<string, unknown> {
  return { ...makeConfig(dummyDir), ...SHIP_VARS, ...overrides } as unknown as Record<
    string,
    unknown
  >
}

function renderSupervisor(overrides: Record<string, unknown> = {}): string {
  return renderTemplate('ship/supervisor.sh.ejs', baseData(overrides))
}

function renderTickPrompt(overrides: Record<string, unknown> = {}): string {
  return renderTemplate('ship/TICK_PROMPT.md.ejs', baseData(overrides))
}

describe('supervisor.sh.ejs render', () => {
  it('is fail-closed bash with HALT + bounded ticks', () => {
    const sh = renderSupervisor()
    expect(sh).toContain('set -euo pipefail')
    expect(sh).toContain('.arbiter/ship/HALT')
    expect(sh).toContain('MAX_TICKS')
  })

  it('contains no sequencing/phase logic (engine owns it)', () => {
    const sh = renderSupervisor()
    for (const phase of ['red-team-review', 'refactor', 'verification', 'preflight']) {
      expect(sh).not.toContain(phase)
    }
  })

  it('tolerates gh failure in the backlog check (no bare $(gh) under set -e)', () => {
    const sh = renderSupervisor()
    expect(sh).toMatch(/if\s+!\s+open=\$\(gh issue list/)
    expect(sh).toContain("--json number --jq 'length'")
  })

  it('quotes the ship label substitution (injection guard)', () => {
    const sh = renderSupervisor()
    expect(sh).toContain("--label 'ship'")
  })

  it('does not bake permission escalation', () => {
    const sh = renderSupervisor()
    expect(sh).not.toContain('--dangerously-skip-permissions')
    expect(sh).toContain('--permission-mode acceptEdits')
    expect(sh).toContain('--max-turns')
  })

  it('never touches engine attempts state', () => {
    expect(renderSupervisor()).not.toContain('attempts.json')
  })

  it('contains no pilot provenance strings', () => {
    const sh = renderSupervisor()
    expect(sh.toLowerCase()).not.toContain('redux')
    expect(sh.toLowerCase()).not.toContain('haben')
  })

  it('renders identically across governance levels (driver is level-agnostic)', () => {
    expect(renderSupervisor({ governanceLevel: 'L1' })).toBe(
      renderSupervisor({ governanceLevel: 'L4' }),
    )
  })
})

describe('TICK_PROMPT.md.ejs render', () => {
  it('delegates failure policy to the engine', () => {
    const md = renderTickPrompt()
    expect(md).toContain('arbiter ship-on-red')
    expect(md).toContain('arbiter ship')
    expect(md).not.toContain('attempts.json')
  })

  it('pins the branch-protection hard rule (no --admin)', () => {
    const md = renderTickPrompt()
    expect(md).toContain('--admin')
    expect(md).toMatch(/[Nn]ever use `--admin`/)
  })

  it('keeps the floor rules', () => {
    const md = renderTickPrompt()
    expect(md).toMatch(/[Nn]ever push/)
    expect(md).toContain('--no-verify')
    expect(md).toMatch(/[Nn]ever commit to main/i)
    expect(md).toMatch(/needs-human/)
  })

  it('forbids self-modification of driver files', () => {
    const md = renderTickPrompt()
    expect(md).toMatch(/[Nn]ever modify the driver files/)
  })

  it('contains no pilot provenance strings', () => {
    const md = renderTickPrompt()
    expect(md.toLowerCase()).not.toContain('redux')
    expect(md.toLowerCase()).not.toContain('haben')
  })
})

describe('cross-stack render (DoD: stacks × governance)', () => {
  const stacks = ['typescript', 'java', 'rust', 'go', 'python'] as const
  const levels = ['L1', 'L2', 'L3', 'L4'] as const

  it('renders both templates without error for every stack × level', () => {
    for (const language of stacks) {
      for (const governanceLevel of levels) {
        const sh = renderSupervisor({ language, governanceLevel })
        const md = renderTickPrompt({ language, governanceLevel })
        expect(sh).toContain('set -euo pipefail')
        expect(md).toContain('arbiter ship-on-red')
      }
    }
  })

  it('output is stack-invariant (no language conditionals in the driver)', () => {
    const base = renderSupervisor({ language: 'typescript' })
    for (const language of stacks) {
      expect(renderSupervisor({ language })).toBe(base)
    }
  })
})
