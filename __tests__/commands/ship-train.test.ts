// SPDX-License-Identifier: Apache-2.0
/**
 * #2331 — bounded sealed trains.
 *
 * A train accumulates issues onto ONE worktree/branch/gate/PR and must stop on an explicit,
 * deterministic rule. An unbounded batch is not a train, it is a long-lived branch — the exact
 * failure mode batching exists to avoid.
 *
 * Every signal consumed here is available BEFORE the appended issue has any diff, because that
 * is when the append decision happens.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  appendChainIds,
  evaluateAffinity,
  evaluateSeal,
  parseTrainAffinity,
  splitTrainIds,
  DEFAULT_TRAIN_LIMITS,
} from '../../src/commands/ship-train'
import type { TrainLimits } from '../../src/commands/ship-train'
import { runTaskShip } from '../../src/commands/task-ship'
import { runTaskInit } from '../../src/commands/task'
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

const at = (iso: string): Date => new Date(iso)
const OPENED = '2026-08-22T00:00:00.000Z'
/** One minute past whatever the default age budget is — derived, so a retuned default never silently disarms the age tests. */
const PAST_AGE_BUDGET = new Date(
  Date.parse(OPENED) + (DEFAULT_TRAIN_LIMITS.maxAgeMinutes + 1) * 60_000,
)
/** #2401 — the pre-config bounds, pinned so the wiring tests below keep testing the wiring, not the default. */
const PINNED_LIMITS: TrainLimits = { maxChain: 5, maxAgeMinutes: 240 }
const AFFINITY = {
  sameOutcome: true,
  ownerPathOverlap: true,
  dependencyRelated: true,
  sharedProof: true,
  orderingCompatible: true,
  sharedAcceptanceBoundary: true,
  sharedRollbackBoundary: true,
  hardConflicts: [] as string[],
}
const LOW_RISK_SIGNALS = {
  labels: [] as string[],
  blastRadius: 0,
  callerCount: 0,
  milestoneBundled: false,
  complete: true,
  changedFiles: ['docs/issue.md'],
}

const signals = (over: Partial<Parameters<typeof evaluateSeal>[0]> = {}) => ({
  chainSize: 0,
  openedAt: OPENED,
  now: at('2026-08-22T00:10:00.000Z'),
  widenedTier: 'S' as const,
  explicitSeal: false,
  affinity: AFFINITY,
  ...over,
})

describe('appendChainIds (#2331)', () => {
  it('appends instead of replacing — the whole point of an accumulating train', () => {
    expect(appendChainIds(['#2'], ['#3'])).toEqual(['#2', '#3'])
  })

  it('normalizes bare numbers to canonical #NNN', () => {
    expect(appendChainIds([], ['7', '#8'])).toEqual(['#7', '#8'])
  })

  it('dedupes against what is already on the train, preserving order', () => {
    expect(appendChainIds(['#2', '#3'], ['3', '#4', '2'])).toEqual(['#2', '#3', '#4'])
  })

  it('rejects a non-numeric id rather than letting it reach the pre-push commit scan', () => {
    expect(() => appendChainIds([], ['not-an-issue'])).toThrow(/Invalid chain id/)
  })

  it('is a no-op for an empty addition list', () => {
    expect(appendChainIds(['#2'], [])).toEqual(['#2'])
  })
})

describe('train affinity (#2681)', () => {
  it('joins only when every component is affirmative and there are no conflicts', () => {
    expect(evaluateAffinity(AFFINITY)).toMatchObject({ decision: 'JOIN' })
  })

  it('has zero false JOINs across the negative component corpus', () => {
    for (const key of Object.keys(AFFINITY).filter((name) => name !== 'hardConflicts')) {
      expect(evaluateAffinity({ ...AFFINITY, [key]: false })).toMatchObject({ decision: 'SEAL' })
    }
    expect(evaluateAffinity({ ...AFFINITY, hardConflicts: ['shared migration'] })).toMatchObject({
      decision: 'SEAL',
    })
    expect(evaluateAffinity(undefined)).toMatchObject({ decision: 'SEAL' })
  })

  it('rejects malformed affinity JSON at the CLI boundary', () => {
    expect(() => parseTrainAffinity('{"sameOutcome":true}')).toThrow(/malformed/i)
  })
})

describe('evaluateSeal (#2331)', () => {
  it('allows a train up to its size limit before sealing the next append', () => {
    expect(evaluateSeal(signals({ chainSize: 4 }), PINNED_LIMITS)).toEqual({ sealed: false })
    expect(evaluateSeal(signals({ chainSize: 5 }), PINNED_LIMITS)).toMatchObject({
      sealed: true,
      reason: 'max-chain',
    })
  })

  it('leaves a young, small, low-risk train open', () => {
    expect(evaluateSeal(signals(), DEFAULT_TRAIN_LIMITS)).toEqual({ sealed: false })
  })

  it('seals when the chain has reached its size limit', () => {
    const verdict = evaluateSeal(
      signals({ chainSize: DEFAULT_TRAIN_LIMITS.maxChain }),
      DEFAULT_TRAIN_LIMITS,
    )
    expect(verdict.sealed).toBe(true)
    expect(verdict).toMatchObject({ reason: 'max-chain' })
  })

  it('leaves the train open one below the size limit — the boundary is inclusive-to-seal', () => {
    const verdict = evaluateSeal(
      signals({ chainSize: DEFAULT_TRAIN_LIMITS.maxChain - 1 }),
      DEFAULT_TRAIN_LIMITS,
    )
    expect(verdict.sealed).toBe(false)
  })

  it('seals once the train is older than its age budget', () => {
    const verdict = evaluateSeal(signals({ now: PAST_AGE_BUDGET }), DEFAULT_TRAIN_LIMITS)
    expect(verdict).toMatchObject({ sealed: true, reason: 'max-age' })
  })

  it('seals immediately when the appended issue widens the tier to Standard', () => {
    const verdict = evaluateSeal(signals({ widenedTier: 'Standard' }), DEFAULT_TRAIN_LIMITS)
    expect(verdict).toMatchObject({ sealed: true, reason: 'risk' })
  })

  it('seals on an explicit request regardless of every other signal', () => {
    const verdict = evaluateSeal(signals({ explicitSeal: true }), DEFAULT_TRAIN_LIMITS)
    expect(verdict).toMatchObject({ sealed: true, reason: 'explicit' })
  })

  it('reports risk ahead of size when both hold, so the operator sees the stronger reason', () => {
    const verdict = evaluateSeal(
      signals({ chainSize: DEFAULT_TRAIN_LIMITS.maxChain, widenedTier: 'Standard' }),
      DEFAULT_TRAIN_LIMITS,
    )
    expect(verdict).toMatchObject({ reason: 'risk' })
  })

  it('treats a train with no recorded open time as fresh, never as infinitely old', () => {
    // FAIL-SAFE: a missing timestamp must not seal every train forever.
    const verdict = evaluateSeal(
      signals({ openedAt: undefined, now: at('2027-01-01T00:00:00.000Z') }),
      DEFAULT_TRAIN_LIMITS,
    )
    expect(verdict).toEqual({ sealed: false })
  })

  it('treats an unparseable open time as fresh rather than throwing mid-ship', () => {
    const verdict = evaluateSeal(signals({ openedAt: 'not-a-date' }), DEFAULT_TRAIN_LIMITS)
    expect(verdict).toEqual({ sealed: false })
  })

  it('honours a maxChain of 1 — no batching at all, which is gated-review behaviour today', () => {
    const verdict = evaluateSeal(signals({ chainSize: 1 }), { maxChain: 1, maxAgeMinutes: 240 })
    expect(verdict).toMatchObject({ sealed: true, reason: 'max-chain' })
  })

  it('carries a human-readable detail on every seal so the banner explains itself', () => {
    for (const over of [
      { chainSize: DEFAULT_TRAIN_LIMITS.maxChain },
      { now: PAST_AGE_BUDGET },
      { widenedTier: 'Standard' as const },
      { explicitSeal: true },
    ]) {
      const verdict = evaluateSeal(signals(over), DEFAULT_TRAIN_LIMITS)
      expect(verdict.sealed).toBe(true)
      if (verdict.sealed) expect(verdict.detail.length).toBeGreaterThan(10)
    }
  })
})

/**
 * #2331 — the wiring. `applyChainAdd` runs before the document is seeded, so a refused append
 * must leave state byte-identical: a sealed train never half-applies.
 */
describe('arbiter ship --chain-add (#2331 wiring)', () => {
  let dir: string

  const ship = (opts: Record<string, unknown> = {}) =>
    runTaskShip({
      dir,
      profileOverride: TEST_PROFILE,
      tier: 'XS',
      gatherTierSignals: () => LOW_RISK_SIGNALS,
      now: new Date('2026-08-22T00:10:00.000Z'),
      trainAffinity: AFFINITY,
      ...opts,
    })

  const chain = (): string[] => readUnifiedState(dir)?.chainIds ?? []

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'arbiter-train-'))
    runTaskShip({
      dir,
      taskId: '#100',
      tier: 'XS',
      profileOverride: TEST_PROFILE,
      gatherTierSignals: () => LOW_RISK_SIGNALS,
    })
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('appends across separate invocations — the accumulating train', () => {
    ship({ chainAddIds: ['#101'] })
    ship({ chainAddIds: ['#102'] })
    expect(chain()).toEqual(['#101', '#102'])
  })

  it('seals an append whose affinity was not proven', () => {
    const before = readUnifiedState(dir)
    expect(() => ship({ chainAddIds: ['#101'], trainAffinity: undefined })).toThrow(
      /SEALED: affinity/,
    )
    expect(readUnifiedState(dir)).toEqual(before)
  })

  it.each([
    ['a false affinity component', { ...AFFINITY, sharedProof: false }],
    ['a hard conflict', { ...AFFINITY, hardConflicts: ['shared migration'] }],
  ])('seals an append with %s', (_name, trainAffinity) => {
    const before = readUnifiedState(dir)
    expect(() => ship({ chainAddIds: ['#101'], trainAffinity })).toThrow(/SEALED: affinity/)
    expect(readUnifiedState(dir)).toEqual(before)
  })

  it.each([
    ['missing qualification', undefined],
    ['incomplete qualification', { ...LOW_RISK_SIGNALS, complete: false }],
  ])('seals an append with %s', (_name, tierSignals) => {
    const before = readUnifiedState(dir)
    expect(() =>
      ship({
        chainAddIds: ['#101'],
        gatherTierSignals: () =>
          tierSignals ?? {
            labels: [],
            blastRadius: null,
            milestoneBundled: false,
          },
      }),
    ).toThrow(/SEALED: risk/)
    expect(readUnifiedState(dir)).toEqual(before)
  })

  it('does not clear a live train when no flag is passed', () => {
    ship({ chainAddIds: ['#101'] })
    ship({})
    expect(chain()).toEqual(['#101'])
  })

  it('stamps chainOpened once and never re-stamps it on later appends', () => {
    ship({ chainAddIds: ['#101'] })
    const first = readUnifiedState(dir)?.timestamps?.chainOpened
    ship({ chainAddIds: ['#102'], now: new Date('2026-08-22T01:00:00.000Z') })
    expect(readUnifiedState(dir)?.timestamps?.chainOpened).toBe(first)
  })

  it('refuses the append once the train is full, naming the reason', () => {
    ship({ chainAddIds: ['#101', '#102', '#103', '#104'], trainLimits: PINNED_LIMITS })
    expect(() => ship({ chainAddIds: ['#105'], trainLimits: PINNED_LIMITS })).toThrow(
      /SEALED: max-chain/,
    )
  })

  it('refuses one append request that would exceed the train limit', () => {
    expect(() =>
      ship({
        chainAddIds: ['#101', '#102', '#103', '#104', '#105'],
        trainLimits: PINNED_LIMITS,
      }),
    ).toThrow(/SEALED: max-chain/)
    expect(chain()).toEqual([])
  })

  it('leaves state untouched when it refuses — a sealed train never half-applies', () => {
    ship({ chainAddIds: ['#101', '#102', '#103', '#104'], trainLimits: PINNED_LIMITS })
    const before = chain()
    expect(() => ship({ chainAddIds: ['#105'], trainLimits: PINNED_LIMITS })).toThrow()
    expect(chain()).toEqual(before)
  })

  it('seals when the appended issue is risk-bearing, without adding it', () => {
    expect(() =>
      ship({
        chainAddIds: ['#101'],
        gatherTierSignals: () => ({ ...LOW_RISK_SIGNALS, labels: ['epic'] }),
      }),
    ).toThrow(/SEALED: risk/)
    expect(chain()).toEqual([])
  })

  it('seals when the primary issue already requires Standard treatment', () => {
    expect(() => ship({ chainAddIds: ['#101'], tier: 'Standard' })).toThrow(/SEALED: risk/)
    expect(chain()).toEqual([])
  })

  it('seals on --seal alone, with no ids to add', () => {
    expect(() => ship({ seal: true })).toThrow(/SEALED: explicit/)
  })

  it('counts the primary issue toward the bound — it rides the same gate and PR', () => {
    // maxChain 2 means primary + one chained, so the second append is refused.
    ship({ chainAddIds: ['#101'], trainLimits: { maxChain: 2, maxAgeMinutes: 240 } })
    expect(() =>
      ship({ chainAddIds: ['#102'], trainLimits: { maxChain: 2, maxAgeMinutes: 240 } }),
    ).toThrow(/SEALED: max-chain/)
  })

  it('seals a train that has outlived its age budget', () => {
    ship({ chainAddIds: ['#101'], trainLimits: PINNED_LIMITS })
    expect(() =>
      ship({
        chainAddIds: ['#102'],
        trainLimits: PINNED_LIMITS,
        now: new Date('2026-08-22T05:00:00.000Z'),
      }),
    ).toThrow(/SEALED: max-age/)
  })

  it('does not seed any fields when a combined seed and append exceeds the limit', () => {
    const fresh = mkdtempSync(join(tmpdir(), 'arbiter-train-atomic-seed-'))
    try {
      expect(() =>
        runTaskShip({
          dir: fresh,
          taskId: '#100',
          tier: 'S',
          overrides: { 'automation.defaultGateLevel': 'L2' },
          chainIds: ['#101'],
          chainAddIds: ['#102', '#103', '#104', '#105'],
          trainLimits: PINNED_LIMITS,
          profileOverride: TEST_PROFILE,
          gatherTierSignals: () => LOW_RISK_SIGNALS,
          now: new Date('2026-08-22T00:10:00.000Z'),
          trainAffinity: AFFINITY,
        }),
      ).toThrow(/SEALED: max-chain/)
      expect(readUnifiedState(fresh)).toBeNull()
    } finally {
      rmSync(fresh, { recursive: true, force: true })
    }
  })

  it('seals a sensitive primary before writing a qualified companion', () => {
    const fresh = mkdtempSync(join(tmpdir(), 'arbiter-train-primary-risk-'))
    try {
      expect(() =>
        runTaskShip({
          dir: fresh,
          taskId: '#100',
          chainAddIds: ['#101'],
          profileOverride: TEST_PROFILE,
          gatherTierSignals: (_root, taskId) =>
            taskId === '#100'
              ? { ...LOW_RISK_SIGNALS, changedFiles: ['src/auth/token.ts'] }
              : LOW_RISK_SIGNALS,
          now: new Date('2026-08-22T00:10:00.000Z'),
          trainAffinity: AFFINITY,
        }),
      ).toThrow(/SEALED: risk/)
      expect(readUnifiedState(fresh)).toBeNull()
    } finally {
      rmSync(fresh, { recursive: true, force: true })
    }
  })

  it('does not mutate a train while its persisted treatment is BLOCKED', () => {
    expect(() =>
      ship({ taskId: '#100', executionOutcome: 'no-progress', chainAddIds: undefined }),
    ).toThrow(/BLOCKED.*no progress/i)
    const before = readUnifiedState(dir)

    expect(() => ship({ chainAddIds: ['#101'] })).toThrow(/BLOCKED.*no progress/i)
    expect(readUnifiedState(dir)).toEqual(before)
  })

  it('allows five chained issues when no primary issue is declared', () => {
    const fresh = mkdtempSync(join(tmpdir(), 'arbiter-train-no-primary-'))
    try {
      runTaskShip({
        dir: fresh,
        chainIds: ['#101', '#102', '#103', '#104'],
        trainAffinity: AFFINITY,
        gatherTierSignals: () => LOW_RISK_SIGNALS,
        profileOverride: TEST_PROFILE,
      })
      runTaskShip({
        dir: fresh,
        chainAddIds: ['#105'],
        trainAffinity: AFFINITY,
        gatherTierSignals: () => LOW_RISK_SIGNALS,
        profileOverride: TEST_PROFILE,
      })
      expect(readUnifiedState(fresh)?.chainIds).toEqual(['#101', '#102', '#103', '#104', '#105'])
    } finally {
      rmSync(fresh, { recursive: true, force: true })
    }
  })
})

it('refuses an initial --chain seed that exceeds the train limit', () => {
  const dir = mkdtempSync(join(tmpdir(), 'arbiter-train-seed-limit-'))
  try {
    runTaskShip({
      dir,
      taskId: '#100',
      tier: 'XS',
      chainIds: ['#101', '#102', '#103', '#104'],
      trainAffinity: AFFINITY,
      gatherTierSignals: () => LOW_RISK_SIGNALS,
      trainLimits: PINNED_LIMITS,
      profileOverride: TEST_PROFILE,
    })
    expect(readUnifiedState(dir)?.chainIds).toEqual(['#101', '#102', '#103', '#104'])
    const before = readUnifiedState(dir)

    expect(() =>
      runTaskShip({
        dir,
        taskId: '#100',
        chainIds: ['#101', '#102', '#103', '#104', '#105'],
        trainAffinity: AFFINITY,
        gatherTierSignals: () => LOW_RISK_SIGNALS,
        trainLimits: PINNED_LIMITS,
        profileOverride: TEST_PROFILE,
      }),
    ).toThrow(/SEALED: max-chain/)
    expect(readUnifiedState(dir)).toEqual(before)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

it('refuses an unsafe --chain replacement without changing the existing train', () => {
  const dir = mkdtempSync(join(tmpdir(), 'arbiter-train-replacement-'))
  try {
    runTaskShip({
      dir,
      taskId: '#100',
      tier: 'XS',
      chainIds: ['#101'],
      trainAffinity: AFFINITY,
      gatherTierSignals: () => LOW_RISK_SIGNALS,
      profileOverride: TEST_PROFILE,
    })
    const before = readUnifiedState(dir)

    expect(() =>
      runTaskShip({
        dir,
        taskId: '#100',
        chainIds: ['#102'],
        trainAffinity: { ...AFFINITY, orderingCompatible: false },
        gatherTierSignals: () => LOW_RISK_SIGNALS,
        profileOverride: TEST_PROFILE,
      }),
    ).toThrow(/SEALED: affinity/)
    expect(readUnifiedState(dir)).toEqual(before)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

it.each([
  ['missing affinity', { gatherTierSignals: () => LOW_RISK_SIGNALS }, /SEALED: affinity/],
  [
    'a false affinity component',
    {
      trainAffinity: { ...AFFINITY, sameOutcome: false },
      gatherTierSignals: () => LOW_RISK_SIGNALS,
    },
    /SEALED: affinity/,
  ],
  [
    'a hard conflict',
    {
      trainAffinity: { ...AFFINITY, hardConflicts: ['shared migration'] },
      gatherTierSignals: () => LOW_RISK_SIGNALS,
    },
    /SEALED: affinity/,
  ],
  ['missing qualification', { trainAffinity: AFFINITY }, /SEALED: risk/],
  [
    'incomplete qualification',
    {
      trainAffinity: AFFINITY,
      gatherTierSignals: () => ({ ...LOW_RISK_SIGNALS, complete: false }),
    },
    /SEALED: risk/,
  ],
])('refuses an initial --chain seed with %s without writing state', (_name, admission, seal) => {
  const dir = mkdtempSync(join(tmpdir(), 'arbiter-train-seed-admission-'))
  try {
    expect(() =>
      runTaskShip({
        dir,
        taskId: '#100',
        tier: 'XS',
        chainIds: ['#101'],
        profileOverride: TEST_PROFILE,
        ...admission,
      }),
    ).toThrow(seal)
    expect(readUnifiedState(dir)).toBeNull()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

it('rejects adding a primary issue to an already-full chain before writing it', () => {
  const dir = mkdtempSync(join(tmpdir(), 'arbiter-train-primary-limit-'))
  try {
    runTaskShip({
      dir,
      chainIds: ['#101', '#102', '#103', '#104', '#105'],
      trainAffinity: AFFINITY,
      gatherTierSignals: () => LOW_RISK_SIGNALS,
      trainLimits: PINNED_LIMITS,
      profileOverride: TEST_PROFILE,
    })
    const before = readUnifiedState(dir)

    expect(() =>
      runTaskShip({
        dir,
        taskId: '#100',
        trainLimits: PINNED_LIMITS,
        profileOverride: TEST_PROFILE,
      }),
    ).toThrow(/SEALED: max-chain/)
    expect(readUnifiedState(dir)).toEqual(before)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

it('does not count a prior task train when a new primary resets task state', () => {
  const dir = mkdtempSync(join(tmpdir(), 'arbiter-train-task-reset-'))
  try {
    runTaskShip({
      dir,
      taskId: '#100',
      tier: 'XS',
      chainIds: ['#101', '#102', '#103', '#104'],
      trainAffinity: AFFINITY,
      gatherTierSignals: () => LOW_RISK_SIGNALS,
      profileOverride: TEST_PROFILE,
    })

    runTaskShip({ dir, taskId: '#200', profileOverride: TEST_PROFILE })

    expect(readUnifiedState(dir)).toMatchObject({ taskId: '#200', phase: 'preflight' })
    expect(readUnifiedState(dir)?.chainIds).toBeUndefined()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

/**
 * #2401 — the train is the DEFAULT unit of ceremony, so `#A #B #C` must be the ergonomic
 * spelling of `#A --chain #B --chain #C`, and the bounds must come from the project's
 * `arbiter.json` rather than a constant.
 */
describe('splitTrainIds (#2401)', () => {
  it('AC-2401.2: takes the first positional as the primary id and chains the rest', () => {
    expect(splitTrainIds(['#101', '#102', '#103'], undefined, [])).toEqual({
      taskId: '#101',
      chainIds: ['#102', '#103'],
    })
  })

  it('AC-2401.2: a single positional is an ordinary single-issue ship', () => {
    expect(splitTrainIds(['#101'], undefined, [])).toEqual({ taskId: '#101', chainIds: [] })
  })

  it('AC-2401.2: an explicit --id keeps every positional on the chain', () => {
    expect(splitTrainIds(['#102', '#103'], '#101', [])).toEqual({
      taskId: '#101',
      chainIds: ['#102', '#103'],
    })
  })

  it('AC-2401.2: merges positional sugar with explicit --chain flags, sugar first', () => {
    expect(splitTrainIds(['#101', '#102'], undefined, ['#103'])).toEqual({
      taskId: '#101',
      chainIds: ['#102', '#103'],
    })
  })

  it('omits taskId entirely when nothing names one — an absent id never becomes an empty id', () => {
    expect(splitTrainIds([], undefined, ['#103'])).toEqual({ chainIds: ['#103'] })
  })

  it('never puts the primary on its own chain — one slot, one `Closes #N`', () => {
    // `#101` and `101` are the same issue: a repeat must not spend a second maxChain slot.
    expect(splitTrainIds(['#101', '101', '#102'], undefined, [])).toEqual({
      taskId: '#101',
      chainIds: ['#102'],
    })
    expect(splitTrainIds(['101'], '#101', ['#102'])).toEqual({
      taskId: '#101',
      chainIds: ['#102'],
    })
  })
})

/** #2402 — `task init` has no affinity or qualification inputs, so it stays single-issue. */
describe('task init refuses multi-issue state (#2402)', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'arbiter-init-bound-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  const ids = (n: number): string[] => Array.from({ length: n }, (_, i) => String(101 + i))

  it('refuses an oversized seed through the same safe route, writing nothing', () => {
    expect(() => runTaskInit({ dir, id: '#100', chainIds: ids(10) })).toThrow(
      /SEALED: affinity.*arbiter ship/,
    )
    expect(readUnifiedState(dir)).toBeNull()
  })

  it('refuses multi-issue task init because it cannot prove admission', () => {
    expect(() => runTaskInit({ dir, id: '#100', chainIds: ids(1) })).toThrow(
      /SEALED: affinity.*arbiter ship/,
    )
    expect(readUnifiedState(dir)).toBeNull()
  })

  it('leaves bounds and admission to `arbiter ship`', () => {
    const oversized = ids(12)
    expect(() => runTaskInit({ dir, id: '#100', chainIds: oversized })).toThrow(/arbiter ship/)
    expect(() =>
      runTaskShip({
        dir,
        taskId: '#100',
        tier: 'XS',
        chainIds: oversized,
        trainAffinity: AFFINITY,
        gatherTierSignals: () => LOW_RISK_SIGNALS,
        profileOverride: TEST_PROFILE,
      }),
    ).toThrow(/SEALED: max-chain/)
  })
})

describe('train limits from arbiter.json (#2401 wiring)', () => {
  const CONFIG = {
    version: '0.2',
    governanceLevel: 'L2',
    tools: ['claude'],
    useGitHub: false,
    features: {
      contractTesting: false,
      mutationTesting: false,
      securityScanning: false,
      evidenceHarness: false,
      debtGates: true,
      suppressions: true,
    },
    thresholds: {
      lineCoverage: 80,
      branchCoverage: 70,
      mutationScore: 80,
      cyclomaticComplexity: 15,
      methodLength: 65,
      maxParams: 7,
    },
  }

  const withConfig = (ship: unknown, run: (dir: string) => void): void => {
    const dir = mkdtempSync(join(tmpdir(), 'arbiter-train-config-'))
    try {
      writeFileSync(join(dir, 'arbiter.json'), JSON.stringify({ ...CONFIG, ship }))
      run(dir)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }

  it('AC-2401.1: a project can shrink its train below the default', () => {
    withConfig({ train: { maxChain: 2 } }, (dir) => {
      runTaskShip({
        dir,
        taskId: '#100',
        tier: 'XS',
        gatherTierSignals: () => LOW_RISK_SIGNALS,
        profileOverride: TEST_PROFILE,
      })
      runTaskShip({
        dir,
        chainAddIds: ['#101'],
        trainAffinity: AFFINITY,
        gatherTierSignals: () => LOW_RISK_SIGNALS,
        profileOverride: TEST_PROFILE,
      })
      expect(() =>
        runTaskShip({
          dir,
          chainAddIds: ['#102'],
          trainAffinity: AFFINITY,
          gatherTierSignals: () => LOW_RISK_SIGNALS,
          profileOverride: TEST_PROFILE,
        }),
      ).toThrow(/SEALED: max-chain/)
    })
  })

  it('AC-2401.1: the default carries ten issues when the config declares no bound', () => {
    withConfig(undefined, (dir) => {
      runTaskShip({
        dir,
        taskId: '#100',
        tier: 'XS',
        gatherTierSignals: () => LOW_RISK_SIGNALS,
        profileOverride: TEST_PROFILE,
      })
      runTaskShip({
        dir,
        chainAddIds: ['#101', '#102', '#103', '#104', '#105', '#106', '#107', '#108', '#109'],
        trainAffinity: AFFINITY,
        gatherTierSignals: () => LOW_RISK_SIGNALS,
        profileOverride: TEST_PROFILE,
      })
      expect(readUnifiedState(dir)?.chainIds).toHaveLength(9)
    })
  })

  it('AC-2401.1: an explicit trainLimits option still beats the config', () => {
    withConfig({ train: { maxChain: 2 } }, (dir) => {
      runTaskShip({
        dir,
        taskId: '#100',
        tier: 'XS',
        gatherTierSignals: () => LOW_RISK_SIGNALS,
        profileOverride: TEST_PROFILE,
      })
      runTaskShip({
        dir,
        chainAddIds: ['#101', '#102'],
        trainAffinity: AFFINITY,
        gatherTierSignals: () => LOW_RISK_SIGNALS,
        trainLimits: PINNED_LIMITS,
        profileOverride: TEST_PROFILE,
      })
      expect(readUnifiedState(dir)?.chainIds).toEqual(['#101', '#102'])
    })
  })
})
