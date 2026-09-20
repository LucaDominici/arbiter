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

function renderShipCommand(): string {
  return renderTemplate('claude/commands/ship.md.ejs', baseData({}))
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
  it('keeps sequencing engine-owned; fix-on-red is prose 2-strike judgment (no dead ship-on-red verb)', () => {
    const md = renderTickPrompt()
    expect(md).toContain('arbiter ship')
    // ship-on-red was retired — fix-on-red is now the agent's 2-strike judgment from PR history.
    expect(md).not.toContain('arbiter ship-on-red')
    expect(md).toContain('2-strike')
    expect(md).toMatch(/needs-human/)
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

  it('AC-2043.4: renders the CONFIGURED escalation max-strikes (not a hardcoded 2)', () => {
    const md = renderTickPrompt({
      e2ePolicy: { escalation: { strikes: [2, 3, 5], maxStrikes: 3 } },
    })
    expect(md).toMatch(/3-strike/)
    expect(md).not.toMatch(/2-strike rule is final/)
  })

  it('AC-2043.4: defaults to the 2-strike ladder when no e2ePolicy is declared', () => {
    const md = renderTickPrompt()
    expect(md).toMatch(/2-strike/)
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
        expect(md).toContain('2-strike')
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

describe('ship command delegates mechanics to the runtime', () => {
  it('removes unenforced delivery promises while retaining hard delivery rules', () => {
    const md = renderShipCommand()

    for (const promise of [
      'Keep the cursor precise during implementation',
      'arbiter lifecycle checkpoint --tdd GREEN',
      'Use the lowest model capability printed by `arbiter ship`',
      'list the complete file set, proof, rollback',
      'smallest executable implementation',
      'run one targeted certification for that HEAD',
      'reconcile every finding from the round into one fix batch',
      'Freeze acceptance, non-goals, files, proof, and rollback',
      'Implement the smallest executable capability',
      'One implementer owns the write lane',
      'Use at most one independent blocker lane',
      "they do not receive the implementer's transcript",
      'independently of the implementer',
    ]) {
      expect(md).not.toContain(promise)
    }

    expect(md).toContain('read the issue and current repository')
    expect(md).toContain('manifest covering every actual changed file')
    expect(md).toMatch(/do not\s+justify source edits by themselves/)
    expect(md).toContain('Add specialist reviewers only for auth')
    expect(md).toContain('The final reviewer covers code, tests, and acceptance fit')
    expect(md).toContain('MED/HIGH/CRITICAL finding')
    expect(md).toContain('exact-subject receipt')
    expect(md).toContain('one full clean-HEAD gate')
  })

  it('keeps the frozen receipt and landing truth in the contract', () => {
    const md = renderShipCommand()
    expect(md).toContain('reuse the unchanged qualification through PR and CI')
    expect(md).toContain('exact-subject receipt')
    expect(md).toContain('merge and green CI are observed')
    expect(md).not.toContain('git rebase')
  })

  it('does not mutate shared Git exclude state', () => {
    const md = renderShipCommand()
    expect(md).not.toContain('.git/info/exclude')
    expect(md).not.toContain('for pattern in')
  })

  it('uses the canonical evidence writer and checker instead of embedded shell', () => {
    const md = renderShipCommand()
    expect(md).toContain('scripts/record-agent-return.mjs --mode reviewer-panel')
    expect(md).toContain('scripts/check-review-completion.mjs')
    expect(md).toContain("reviewer envelope's")
    expect(md).toContain('must be the exact assigned')
    expect(md).not.toContain('check-cross-model-review.mjs')
  })

  it('fails closed on missing, stale, or material review evidence', () => {
    const md = renderShipCommand()
    expect(md).toContain('rejects missing or malformed envelopes')
    expect(md).toContain('a different task/branch/SHA')
    expect(md).toContain('MED/HIGH/CRITICAL finding')
  })
})

// ── #1292 (ADR-093 §5): self-only boundary — locked forever ──────────────────
//
// Template-authoring rules (CANON-04/05/13/14/18), matrix promotion
// (CANON-02/03, INV-32), selfOnly invariants (INV-107/108/111/117/120) and
// kit-leakage guards (INV-85, kit-source) are arbiter-self concerns. They must
// NEVER be emitted into a consumer driver (INV-115 map-fiction). Table-driven:
// every rendered driver artifact × every banned marker.

describe('self-only boundary (#1292, ADR-093 §5)', () => {
  const artifacts: ReadonlyArray<readonly [string, () => string]> = [
    ['supervisor.sh', () => renderSupervisor()],
    ['TICK_PROMPT.md', () => renderTickPrompt()],
    ['claude command ship.md', renderShipCommand],
  ]

  // Exact tokens (anchored so the dual-sided INV-114 in ship.md never false-positives).
  const selfOnlyTokens = [
    'INV-107',
    'INV-108',
    'INV-111',
    'INV-117',
    'INV-120',
    'INV-85',
    'INV-32',
  ] as const

  for (const [name, render] of artifacts) {
    it(`${name} contains no CANON-NN references (consumers have no CANON.md)`, () => {
      expect(render()).not.toMatch(/CANON-\d+/)
    })

    for (const token of selfOnlyTokens) {
      it(`${name} does not leak self-only token ${token}`, () => {
        expect(render()).not.toMatch(new RegExp(`\\b${token}(?!\\d)`))
      })
    }

    it(`${name} contains no cross-language-matrix references (matrix promotion is self-only)`, () => {
      expect(render()).not.toContain('cross-language-matrix')
    })

    it(`${name} contains no src/templates paths (template authoring is self-only)`, () => {
      expect(render()).not.toContain('src/templates')
    })

    it(`${name} contains no kit-source references (kit leakage, INV-85)`, () => {
      expect(render()).not.toMatch(/\bkit-source\b/)
    })
  }
})
