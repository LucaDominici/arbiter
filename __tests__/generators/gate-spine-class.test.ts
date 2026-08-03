// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from 'vitest'
import { isGateSpineKey } from '../../src/generators/safety-class.js'
import { buildAdoptPredicate, withheldSafetyKeys } from '../../src/commands/update.js'
import type { WriteResult } from '../../src/utils/fs.js'

describe('isGateSpineKey (#2109 — gate-spine adopt class, opt-in since #2119)', () => {
  it('matches the gate entrypoint and every script it loads from scripts/lib/', () => {
    expect(isGateSpineKey('scripts/check-all.mjs')).toBe(true)
    expect(isGateSpineKey('scripts/lib/glob-walk.mjs')).toBe(true)
    expect(isGateSpineKey('scripts/lib/run-helpers.mjs')).toBe(true)
    // Monotonic by directory: a lib added later is covered without touching this list.
    expect(isGateSpineKey('scripts/lib/some-future-helper.mjs')).toBe(true)
  })

  it('does NOT match a leaf check script — that is where a project tunes its thresholds', () => {
    expect(isGateSpineKey('scripts/check-bloat-ratchet.mjs')).toBe(false)
    expect(isGateSpineKey('scripts/check-docs.mjs')).toBe(false)
    expect(isGateSpineKey('scripts/evidence-collect.mjs')).toBe(false)
  })

  it('does not match a nested subdirectory under scripts/lib/ (single segment only)', () => {
    expect(isGateSpineKey('scripts/lib/sub/glob-walk.mjs')).toBe(false)
  })

  it('does not match a non-.mjs file in scripts/lib/', () => {
    expect(isGateSpineKey('scripts/lib/README.md')).toBe(false)
  })

  it('requires the exact posix prefix — no partial or absolute-path match', () => {
    expect(isGateSpineKey('sub/scripts/check-all.mjs')).toBe(false)
    expect(isGateSpineKey('/root/scripts/check-all.mjs')).toBe(false)
    expect(isGateSpineKey('scripts/check-all.mjs.ejs')).toBe(false)
  })

  it('does not swallow the safety class or anything else', () => {
    expect(isGateSpineKey('.claude/hooks/stop-dangerous.mjs')).toBe(false)
    expect(isGateSpineKey('arbiter.json')).toBe(false)
  })
})

const NO_FLAGS = { dir: undefined, github: false }

/**
 * #2141 red phase: this local test-only extension expresses the pending CLI
 * option without changing the production UpdateOptions contract before the
 * implementation lands.
 */
interface AdoptGovernanceOptions {
  dir: undefined
  github: false
  adoptGovernance: true
}

describe('buildAdoptPredicate — gate spine is opt-in (#2119)', () => {
  it('WITHHOLDS a user-modified gate spine with no flags at all', () => {
    const predicate = buildAdoptPredicate(NO_FLAGS)
    expect(predicate('scripts/check-all.mjs')).toBe(false)
    expect(predicate('scripts/lib/glob-walk.mjs')).toBe(false)
    expect(predicate('scripts/lib/run-helpers.mjs')).toBe(false)
  })

  it('still leaves an ordinary skipIfExists file withheld without --adopt', () => {
    const predicate = buildAdoptPredicate(NO_FLAGS)
    expect(predicate('scripts/check-bloat-ratchet.mjs')).toBe(false)
    expect(predicate('.claude/rules/50-batch-execution.md')).toBe(false)
  })

  it('--adopt-gate-spine is the explicit opt-in, and it leaves safety hooks adopted', () => {
    const predicate = buildAdoptPredicate({ ...NO_FLAGS, adoptGateSpine: true })
    expect(predicate('scripts/check-all.mjs')).toBe(true)
    expect(predicate('scripts/lib/glob-walk.mjs')).toBe(true)
    expect(predicate('.claude/hooks/stop-dangerous.mjs')).toBe(true)
  })

  it('--no-adopt-safety freezes safety hooks, and the spine stays withheld without the opt-in', () => {
    const predicate = buildAdoptPredicate({ ...NO_FLAGS, noAdoptSafety: true })
    expect(predicate('.claude/hooks/stop-dangerous.mjs')).toBe(false)
    expect(predicate('scripts/check-all.mjs')).toBe(false)
  })

  it('--adopt still broadens to everything', () => {
    const predicate = buildAdoptPredicate({ ...NO_FLAGS, adopt: true })
    expect(predicate('scripts/check-bloat-ratchet.mjs')).toBe(true)
  })
})

describe('buildAdoptPredicate — governance files are opt-in (#2141)', () => {
  it('WITHHOLDS a user-modified AGENTS.md with no flags at all', () => {
    const predicate = buildAdoptPredicate(NO_FLAGS)

    expect(predicate('AGENTS.md')).toBe(false)
  })

  it('WITHHOLDS a user-modified .claude/settings.json with no flags at all', () => {
    const predicate = buildAdoptPredicate(NO_FLAGS)

    expect(predicate('.claude/settings.json')).toBe(false)
  })

  it('--adopt-governance is the explicit opt-in for both governance files', () => {
    const options: AdoptGovernanceOptions = { ...NO_FLAGS, adoptGovernance: true }
    const predicate = buildAdoptPredicate(options)

    expect(predicate('AGENTS.md')).toBe(true)
    expect(predicate('.claude/settings.json')).toBe(true)
  })

  it('adoptGovernance leaves a gate-spine key withheld and keeps safety hooks adopted', () => {
    const governanceOptions: AdoptGovernanceOptions = { ...NO_FLAGS, adoptGovernance: true }
    const governancePredicate = buildAdoptPredicate(governanceOptions)

    expect(governancePredicate('scripts/check-all.mjs')).toBe(false)
    expect(governancePredicate('.claude/hooks/stop-dangerous.mjs')).toBe(true)
  })

  it('adoptGateSpine leaves AGENTS.md withheld and keeps safety hooks adopted', () => {
    const gateSpinePredicate = buildAdoptPredicate({ ...NO_FLAGS, adoptGateSpine: true })

    expect(gateSpinePredicate('AGENTS.md')).toBe(false)
    expect(gateSpinePredicate('.claude/hooks/stop-dangerous.mjs')).toBe(true)
  })

  it('adoptGateSpine leaves .claude/settings.json withheld and keeps safety hooks adopted', () => {
    const gateSpinePredicate = buildAdoptPredicate({ ...NO_FLAGS, adoptGateSpine: true })

    expect(gateSpinePredicate('.claude/settings.json')).toBe(false)
    expect(gateSpinePredicate('.claude/hooks/stop-dangerous.mjs')).toBe(true)
  })
})

function withheld(path: string): WriteResult {
  return { path, action: 'skipped', withheld: true } as WriteResult
}

describe('withheldSafetyKeys — the ratchet sees a frozen spine too (#2109, kept by #2119)', () => {
  it('reports a still-withheld gate-spine file, so check-safety-adopt-ratchet turns red', () => {
    const keys = withheldSafetyKeys(
      [withheld('/repo/scripts/check-all.mjs'), withheld('/repo/scripts/lib/glob-walk.mjs')],
      '/repo',
    )
    expect(keys).toEqual(['scripts/check-all.mjs', 'scripts/lib/glob-walk.mjs'])
  })

  it('keeps reporting withheld safety hooks — the existing class is not displaced', () => {
    const keys = withheldSafetyKeys([withheld('/repo/.claude/hooks/stop-dangerous.mjs')], '/repo')
    expect(keys).toEqual(['.claude/hooks/stop-dangerous.mjs'])
  })

  it('ignores a withheld file in neither class', () => {
    const keys = withheldSafetyKeys([withheld('/repo/scripts/check-docs.mjs')], '/repo')
    expect(keys).toEqual([])
  })
})
