// SPDX-License-Identifier: Apache-2.0
// #2891 — XS/S consumer train profile: disjoint-file affinity from plan manifests, maxChain 3,
// member eject on chain re-declare. RED skeleton.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  DEFAULT_TRAIN_LIMITS,
  disjointFilesFor,
  evaluateAffinity,
  evaluateSeal,
  resolveTrainLimits,
} from '../../src/commands/ship-train'
import { runTaskShip } from '../../src/commands/task-ship'
import { readUnifiedState } from '../../src/commands/task-state'
import type { ShipProfile } from '../../src/commands/ship-profile'

const TEST_PROFILE: ShipProfile = {
  isArbiterSelf: false,
  collaborationMode: 'peer-review',
  mergeMode: 'pr-ff',
  governanceLevel: 'L2',
  autonomy: 'L0',
  evidenceHarness: false,
  defaultGateLevel: 'L1',
  companions: [],
}
const LOW_RISK_SIGNALS = {
  labels: [] as string[],
  blastRadius: 0,
  callerCount: 0,
  milestoneBundled: false,
  complete: true,
  changedFiles: ['docs/issue.md'],
}
/** The XS/S profile: no ownerPathOverlap / dependencyRelated, disjointFiles instead. */
const XS_AFFINITY = {
  sameOutcome: true,
  sharedProof: true,
  orderingCompatible: true,
  sharedAcceptanceBoundary: true,
  sharedRollbackBoundary: true,
  hardConflicts: [] as string[],
}

function writePlan(dir: string, id: string, files: readonly string[]): string {
  const rel = `.claude/plans/task-${id}.md`
  mkdirSync(join(dir, '.claude', 'plans'), { recursive: true })
  writeFileSync(
    join(dir, rel),
    `---\nfiles:\n${files.map((f) => `  - ${f}`).join('\n')}\n---\n\n# plan ${id}\n`,
    'utf-8',
  )
  return rel
}

describe('XS/S train profile (#2891 AC-1/AC-2)', () => {
  it('JOINs a disjoint-file XS pair without ownerPathOverlap/dependencyRelated', () => {
    expect(
      evaluateAffinity({ ...XS_AFFINITY, disjointFiles: true }, { widestTier: 'XS' }),
    ).toMatchObject({ decision: 'JOIN' })
  })

  it('still SEALs the XS profile when files overlap', () => {
    expect(
      evaluateAffinity({ ...XS_AFFINITY, disjointFiles: false }, { widestTier: 'S' }),
    ).toMatchObject({ decision: 'SEAL' })
  })

  it('Standard widest tier never uses the XS profile — seals with reason risk', () => {
    const verdict = evaluateSeal(
      {
        chainSize: 1,
        openedAt: '2026-08-22T00:00:00.000Z',
        now: new Date('2026-08-22T00:10:00.000Z'),
        widenedTier: 'Standard',
        explicitSeal: false,
        affinity: { ...XS_AFFINITY, disjointFiles: true },
      },
      DEFAULT_TRAIN_LIMITS,
    )
    expect(verdict).toMatchObject({ sealed: true, reason: 'risk' })
  })

  it('defaults maxChain to 3 for the XS/S profile while Standard keeps 10', () => {
    expect(resolveTrainLimits(undefined, 'XS')).toMatchObject({ maxChain: 3 })
    expect(resolveTrainLimits(undefined, 'Standard')).toMatchObject({ maxChain: 10 })
  })
})

describe('disjointFiles is computed from plan manifests, not declared (#2891 AC-1)', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'arbiter-train-xs-'))
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('is true for two plans whose manifests share no file', () => {
    const a = writePlan(dir, '100', ['src/a.ts', 'docs/a.md'])
    const b = writePlan(dir, '101', ['src/b.ts'])
    expect(disjointFilesFor(dir, [a, b])).toBe(true)
  })

  it('is false when any file appears in both manifests', () => {
    const a = writePlan(dir, '100', ['src/a.ts', 'src/shared.ts'])
    const b = writePlan(dir, '101', ['src/shared.ts'])
    expect(disjointFilesFor(dir, [a, b])).toBe(false)
  })

  it('is false (fail-closed) when a plan has no manifest', () => {
    const a = writePlan(dir, '100', ['src/a.ts'])
    expect(disjointFilesFor(dir, [a, '.claude/plans/task-missing.md'])).toBe(false)
  })
})

describe('member eject on --chain re-declare (#2891 AC-3)', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'arbiter-train-eject-'))
    runTaskShip({
      dir,
      taskId: '#100',
      tier: 'XS',
      chainIds: ['#101', '#102'],
      profileOverride: TEST_PROFILE,
      gatherTierSignals: () => LOW_RISK_SIGNALS,
      trainAffinity: { ...XS_AFFINITY, disjointFiles: true },
    })
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('accepts a re-declare without one member and reports it as ejected', () => {
    const result = runTaskShip({
      dir,
      taskId: '#100',
      tier: 'XS',
      chainIds: ['#101'],
      profileOverride: TEST_PROFILE,
      gatherTierSignals: () => LOW_RISK_SIGNALS,
      trainAffinity: { ...XS_AFFINITY, disjointFiles: true },
    })
    expect(readUnifiedState(dir)?.chainIds).toEqual(['#101'])
    expect(result.trainDecision).toMatchObject({ ejected: ['#102'] })
  })
})
