import { describe, it, expect } from 'vitest'
import { renderTemplate } from '../../src/utils/render.js'
import { makeConfig } from '../helpers.js'
import type { GovernanceLevel } from '../../src/wizard/types.js'

/**
 * M11: Workflow commands — governance level affects command content.
 * #1216: /ship is the orchestration entrypoint; /task is the engine/CLI reference.
 *
 * L1: minimal workflow
 * L2: full workflow (L1 + tier guidance, code review agents, verifier, cleanup)
 * L3: full workflow (L2 + verification criteria, SSOT updates)
 *
 * INV-11: All governance levels tested.
 */

function renderTaskForLevel(level: GovernanceLevel): string {
  const config = makeConfig('/tmp/test', { governanceLevel: level })
  return renderTemplate('claude/commands/task.md.ejs', config as unknown as Record<string, unknown>)
}

function renderShipForLevel(
  level: GovernanceLevel,
  collaborationMode = 'peer-review',
  mergeMode = 'pr-ff',
): string {
  const config = makeConfig('/tmp/test', {
    governanceLevel: level,
    collaborationMode: collaborationMode as 'trunk-solo' | 'peer-review' | 'gated-review',
  })
  return renderTemplate('claude/commands/ship.md.ejs', {
    ...(config as unknown as Record<string, unknown>),
    mergeMode,
  })
}

// ---------------------------------------------------------------------------
// task.md — engine/CLI reference (governance-level-agnostic after #1216)
// ---------------------------------------------------------------------------

describe('claude commands — task.md engine reference (all levels)', () => {
  it('has /ship pointer at top', () => {
    const content = renderTaskForLevel('L1')
    expect(content).toContain('/ship')
  })

  it('has subcommand reference (arbiter task init + advance)', () => {
    const content = renderTaskForLevel('L2')
    expect(content).toContain('arbiter task init')
    expect(content).toContain('arbiter task advance')
  })

  it('does NOT contain tier classification (XS/Standard) — moved to /ship', () => {
    const content = renderTaskForLevel('L1')
    expect(content).not.toMatch(/\bXS\b/)
    expect(content).not.toMatch(/\bStandard\b/)
  })

  it('does NOT contain L2 tier classification — moved to /ship', () => {
    const content = renderTaskForLevel('L2')
    // tier classification is in ship.md's phase map, not in task.md engine ref
    expect(content).not.toMatch(/Tier XS|Tier Standard/)
  })

  it('does NOT contain code review agent dispatch — moved to /ship', () => {
    const content = renderTaskForLevel('L2')
    expect(content).not.toMatch(/agents-dispatched/)
  })

  it('does NOT contain adversarial verifier — moved to /ship', () => {
    const content = renderTaskForLevel('L2')
    expect(content).not.toMatch(/Adversarial Verifier/)
  })

  it('does NOT contain worktree slash command — moved to /ship', () => {
    const content = renderTaskForLevel('L2')
    expect(content).not.toMatch(/wt-open/)
  })

  it('does NOT contain state file writes (echo to .task-id / .task-phase)', () => {
    const content = renderTaskForLevel('L1')
    // These were bash state writes in old orchestration prose; engine-ref doesn't have them
    // Note: .claude/.task-id appears in record-tech-debt help text — that's a ref, not a write
    expect(content).not.toMatch(/echo.*\.task-id|printf.*\.task-id|>.*\.task-phase/)
  })

  it('no EJS leaks at L2', () => {
    const content = renderTaskForLevel('L2')
    expect(content).not.toContain('<%')
    expect(content).not.toContain('%>')
  })
})

// ---------------------------------------------------------------------------
// ship.md — orchestration features gated by governance level (#1216)
// ---------------------------------------------------------------------------

describe('claude commands — ship.md governance level L1', () => {
  it('has gate section', () => {
    const content = renderShipForLevel('L1')
    expect(content).toMatch(/gate|Gate/i)
  })

  it('does NOT contain tier classification note at L1', () => {
    const content = renderShipForLevel('L1')
    // L1 doesn't show the tier note in the phase map
    expect(content).not.toMatch(/The tier \(XS \/ S \/ Standard\)/)
  })
})

describe('claude commands — ship.md governance level L2', () => {
  it('includes tier guidance in phase map', () => {
    const content = renderShipForLevel('L2')
    expect(content).toMatch(/XS|Standard/)
  })

  it('includes code review agent dispatch (agents-dispatched)', () => {
    const content = renderShipForLevel('L2', 'peer-review')
    expect(content).toMatch(/agents-dispatched/)
  })

  it('includes adversarial verifier', () => {
    const content = renderShipForLevel('L2', 'peer-review')
    expect(content).toMatch(/Adversarial Verifier/)
  })

  it('includes worktree recommendation', () => {
    const content = renderShipForLevel('L2')
    expect(content).toMatch(/wt-open/)
  })

  it('includes done-evidence cleanup when the evidence harness is on (#1345)', () => {
    const config = makeConfig('/tmp/test', {
      governanceLevel: 'L2',
      collaborationMode: 'peer-review',
      enableEvidenceHarness: true,
    })
    const content = renderTemplate('claude/commands/ship.md.ejs', {
      ...(config as unknown as Record<string, unknown>),
      mergeMode: 'pr-ff',
    })
    expect(content).toContain('done-evidence.mjs')
  })

  it('does NOT contain verification criteria (L3 only)', () => {
    const content = renderShipForLevel('L2')
    expect(content).not.toMatch(/Verification criteria/i)
  })

  it('includes unified task-document init', () => {
    const content = renderShipForLevel('L2')
    expect(content).toContain('arbiter task init')
  })
})

describe('claude commands — ship.md governance level L3', () => {
  it('includes evidence content', () => {
    const content = renderShipForLevel('L3')
    expect(content).toMatch(/verif|evidence/i)
  })

  it('includes all L2 features', () => {
    const content = renderShipForLevel('L3', 'peer-review')
    expect(content).toMatch(/agents-dispatched/)
    expect(content).toMatch(/wt-open/)
    expect(content).toContain('arbiter task init')
  })
})

describe('claude commands - ship.md mandatory plan sections (B1L, #2179)', () => {
  it('contains all mandatory plan sections', () => {
    const levels: GovernanceLevel[] = ['L1', 'L2', 'L3']
    for (const level of levels) {
      const content = renderShipForLevel(level)
      for (const marker of [
        'Approach & decomposition',
        'Threat model & abuse cases',
        'Input validation',
        'Idiomatic patterns & pitfalls',
        'Test strategy',
        'Risks',
        'draft, then revise once',
      ]) {
        expect(content).toContain(marker)
      }
    }
  })
})
