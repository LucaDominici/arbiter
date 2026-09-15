// SPDX-License-Identifier: Apache-2.0
//
// Deterministic /ship tier widening (#2180): graph + issue metadata can only widen routing.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { cleanupTestProject, createTestProject } from '../helpers.js'
import { runTaskShip, shipStepFor } from '../../src/commands/task-ship.js'
import { writeUnifiedState } from '../../src/commands/task-state.js'
import {
  gatherTierSignals,
  resolveShipTreatment,
  widenTier,
  type ShipTier,
  type TierSignals,
} from '../../src/commands/ship-tier.js'

const { runCli, runCliJson } = vi.hoisted(() => ({
  runCli: vi.fn(() => ({ stdout: '', stderr: '', exitCode: 0, durationMs: 0 })),
  runCliJson: vi.fn(),
}))

vi.mock('../../src/utils/run-cli.js', () => ({ runCli, runCliJson }))

const tiers: readonly ShipTier[] = ['XS', 'S', 'Standard']
const blastRadii = [null, 0, 24, 25, 74, 75, 1000, Number.NaN, -1] as const
const labelSets: readonly (readonly string[])[] = [
  [],
  ['bug'],
  ['wave'],
  ['epic/decompose'],
  ['WAVE'],
]

function tierRank(tier: ShipTier): number {
  return tiers.indexOf(tier)
}

function neutralSignals(): TierSignals {
  return {
    blastRadius: null,
    callerCount: null,
    changedFiles: [],
    complete: false,
    labels: [],
    milestoneBundled: false,
  }
}

function completeSignals(overrides: Partial<TierSignals> = {}): TierSignals {
  return {
    blastRadius: 0,
    callerCount: 0,
    changedFiles: ['docs/guide.md'],
    complete: true,
    labels: [],
    milestoneBundled: false,
    ...overrides,
  }
}

function writePlanWithFiles(dir: string, files: readonly string[]): void {
  const planDir = join(dir, '.claude', 'plans')
  mkdirSync(planDir, { recursive: true })
  writeFileSync(
    join(planDir, 'task-2180.md'),
    `---\nfiles:\n${files.map((file) => `  - ${file}`).join('\n')}\n---\n\n# Test plan\n`,
    'utf-8',
  )
  writeUnifiedState(dir, { taskId: '#2180', plan: '.claude/plans/task-2180.md' })
}

function writeFile(dir: string, relativePath: string): string {
  const path = join(dir, relativePath)
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, 'fixture\n', 'utf-8')
  return path
}

describe('widenTier (#2180)', () => {
  it('never narrows for every base tier and deterministic signal matrix', () => {
    for (const base of tiers) {
      for (const blastRadius of blastRadii) {
        for (const labels of labelSets) {
          for (const milestoneBundled of [false, true]) {
            const signals: TierSignals = { blastRadius, labels, milestoneBundled }
            expect(tierRank(widenTier(base, signals))).toBeGreaterThanOrEqual(tierRank(base))
          }
        }
      }
    }
  })

  it('floors XS to Standard for wave/epic labels, not ordinary outcome milestones', () => {
    for (const labels of [['wave'], ['epic'], ['epic/decompose'], ['WAVE']]) {
      expect(widenTier('XS', { ...neutralSignals(), labels })).toBe('Standard')
    }
    expect(widenTier('XS', { ...neutralSignals(), milestoneBundled: true })).toBe('XS')
    expect(widenTier('XS', { ...neutralSignals(), labels: ['bug'] })).toBe('XS')
  })

  it('applies only calibrated blast-radius floors', () => {
    expect(widenTier('XS', { ...neutralSignals(), blastRadius: 24 })).toBe('XS')
    expect(widenTier('XS', { ...neutralSignals(), blastRadius: 25 })).toBe('S')
    expect(widenTier('XS', { ...neutralSignals(), blastRadius: 75 })).toBe('Standard')
    for (const blastRadius of [null, Number.NaN, -1]) {
      expect(widenTier('XS', { ...neutralSignals(), blastRadius })).toBe('XS')
    }
  })
})

describe('resolveShipTreatment (#2681)', () => {
  it('requires affirmative complete evidence before selecting XS or S', () => {
    expect(resolveShipTreatment('XS', neutralSignals())).toMatchObject({
      tier: 'Standard',
      qualifiedNarrow: false,
      modelCapability: 'capable',
      finalReviewers: 2,
    })
    expect(resolveShipTreatment('XS', completeSignals())).toMatchObject({
      tier: 'XS',
      qualifiedNarrow: true,
      planDepth: 'minimal',
      preCodeReviewers: 0,
      finalReviewers: 1,
      reviewerVerticals: ['domain'],
      modelCapability: 'economy',
    })
    expect(resolveShipTreatment('Standard', neutralSignals()).reasons).toEqual([
      'Standard treatment selected without narrow qualification',
    ])
  })

  it('widens on directional callers and core paths', () => {
    expect(resolveShipTreatment('XS', completeSignals({ callerCount: 2 })).tier).toBe('S')
    expect(
      resolveShipTreatment('XS', completeSignals({ changedFiles: ['src/commands/task-ship.ts'] }))
        .tier,
    ).toBe('Standard')
  })

  it('adds only pertinent sensitive specialists and caps final reviewers at three', () => {
    const treatment = resolveShipTreatment(
      'XS',
      completeSignals({
        changedFiles: ['src/auth/token.ts', 'migrations/001.sql', '.github/workflows/ci.yml'],
      }),
    )
    expect(treatment).toMatchObject({
      tier: 'Standard',
      sensitive: true,
      finalReviewers: 3,
      modelCapability: 'frontier',
    })
    expect(treatment.reviewerVerticals).toEqual(['security', 'migration', 'deployment'])
  })

  it('keeps Standard at two reviewers for non-sensitive contract paths', () => {
    const treatment = resolveShipTreatment(
      'Standard',
      completeSignals({ changedFiles: ['docs/adaptive-contract.md'] }),
    )

    expect(treatment).toMatchObject({
      sensitive: false,
      finalReviewers: 2,
      reviewerVerticals: ['domain', 'test-quality'],
    })
  })

  it('never narrows a treatment already widened in the same task', () => {
    const previous = resolveShipTreatment('XS', neutralSignals())
    const resumed = resolveShipTreatment('XS', completeSignals(), previous)
    expect(resumed.tier).toBe('Standard')
    expect(resumed.reasons).toContain('preserved prior widening')
  })

  it('preserves specialist seats after later qualification inputs become unavailable', () => {
    const previous = resolveShipTreatment(
      'XS',
      completeSignals({ changedFiles: ['src/auth/token.ts', 'migrations/001.sql'] }),
    )
    const resumed = resolveShipTreatment('XS', neutralSignals(), previous)
    expect(resumed).toMatchObject({ tier: 'Standard', sensitive: true, finalReviewers: 3 })
    expect(resumed.reviewerVerticals).toEqual(['security', 'migration', 'domain'])
  })

  it('escalates only for a new material risk and keeps infrastructure states separate', () => {
    const base = resolveShipTreatment('XS', completeSignals())
    const risk = resolveShipTreatment('XS', completeSignals({ executionOutcome: 'new-risk' }), base)
    const infra = resolveShipTreatment('XS', completeSignals({ executionOutcome: 'timeout' }), base)
    expect(risk.modelCapability).toBe('capable')
    expect(risk.reasons).toContain('model escalated after a new material risk')
    expect(infra.modelCapability).toBe('economy')
    expect(infra.reasons).toContain('infrastructure state: timeout; model unchanged')
  })
})

describe('gatherTierSignals (#2180)', () => {
  let dir: string

  beforeEach(() => {
    dir = createTestProject()
    runCli.mockReset()
    runCli.mockReturnValue({ stdout: '', stderr: '', exitCode: 0, durationMs: 0 })
    runCliJson.mockReset()
  })
  afterEach(() => cleanupTestProject(dir))

  it('returns a null blast radius when graphify output is unavailable', () => {
    writePlanWithFiles(dir, ['src/changed.ts'])
    writeFile(dir, 'src/changed.ts')

    expect(existsSync(join(dir, 'graphify-out', 'graph.json'))).toBe(false)
    expect(gatherTierSignals(dir, undefined, '.claude/plans/task-2180.md')).toMatchObject({
      blastRadius: null,
      callerCount: null,
      complete: false,
    })
  })

  it('reads lowercased GitHub labels and milestone bundling through the sanctioned CLI wrapper', () => {
    runCliJson.mockReturnValue({
      labels: [{ name: 'WAVE' }, { name: 'bug' }],
      milestone: { title: 'release train' },
    })

    expect(gatherTierSignals(dir, '#2180', '.claude/plans/task-2180.md')).toMatchObject({
      labels: ['wave', 'bug'],
      milestoneBundled: true,
    })
    expect(runCliJson).toHaveBeenCalledWith(
      'gh',
      ['issue', 'view', '2180', '--json', 'labels,milestone'],
      { cwd: dir, timeoutMs: 10_000 },
    )
  })

  it('makes GitHub metadata failures neutral', () => {
    runCliJson.mockImplementation(() => {
      throw new Error('gh unavailable')
    })

    expect(gatherTierSignals(dir, '#2180', '.claude/plans/task-2180.md')).toMatchObject({
      labels: [],
      milestoneBundled: false,
    })
  })

  it('refuses narrow routing when the checkout contains a file omitted from the plan', () => {
    writePlanWithFiles(dir, ['docs/guide.md'])
    runCliJson.mockReturnValue({ labels: [], milestone: null })
    runCli.mockImplementation((_cmd, args) => ({
      stdout: args[0] === 'diff' && args.includes('origin/main...HEAD') ? 'src/unplanned.ts\n' : '',
      stderr: '',
      exitCode: 0,
      durationMs: 0,
    }))

    expect(gatherTierSignals(dir, '#2180', '.claude/plans/task-2180.md')).toMatchObject({
      changedFiles: ['docs/guide.md', 'src/unplanned.ts'],
      complete: false,
    })
  })

  it('does not trust a graph older than a manifest file', () => {
    writePlanWithFiles(dir, ['src/changed.ts'])
    const changed = writeFile(dir, 'src/changed.ts')
    const graphDir = join(dir, 'graphify-out')
    mkdirSync(graphDir, { recursive: true })
    const graph = join(graphDir, 'graph.json')
    writeFileSync(graph, JSON.stringify({ directed: false, nodes: [], links: [] }), 'utf-8')
    const now = new Date()
    utimesSync(graph, new Date(now.getTime() - 2_000), new Date(now.getTime() - 2_000))
    utimesSync(changed, now, now)

    expect(gatherTierSignals(dir, '#2180', '.claude/plans/task-2180.md')).toMatchObject({
      blastRadius: null,
      complete: false,
    })
  })

  it('counts only distinct dependent files on allowlisted edges, excluding contains', () => {
    writePlanWithFiles(dir, ['src/changed.ts', 'src/also-changed.ts'])
    const changed = writeFile(dir, 'src/changed.ts')
    const alsoChanged = writeFile(dir, 'src/also-changed.ts')
    const graphDir = join(dir, 'graphify-out')
    mkdirSync(graphDir, { recursive: true })
    const graph = join(graphDir, 'graph.json')
    writeFileSync(
      graph,
      JSON.stringify({
        directed: false,
        nodes: [
          { id: 'changed', source_file: 'src/changed.ts' },
          { id: 'also-changed', source_file: 'src/also-changed.ts' },
          { id: 'dependent-a', source_file: 'src/dependent-a.ts' },
          { id: 'dependent-b', source_file: 'src/dependent-b.ts' },
          { id: 'dependent-b-symbol', source_file: 'src/dependent-b.ts' },
          { id: 'containment-only', source_file: 'src/containment-only.ts' },
          { id: 'unrelated', source_file: 'src/unrelated.ts' },
          { id: 'missing-file', source_file: 'src/missing-file.ts' },
          { id: 'no-source' },
          { id: 'other-no-source' },
        ],
        links: [
          { source: 'changed', target: 'dependent-a', relation: 'imports' },
          { source: 'also-changed', target: 'dependent-b', relation: 'calls' },
          { source: 'changed', target: 'dependent-b-symbol', relation: 'references' },
          { source: 'changed', target: 'containment-only', relation: 'contains' },
          { source: 'changed', target: 'missing-file', relation: 'unknown' },
          { source: 'unrelated', target: 'missing-file', relation: 'imports' },
        ],
      }),
      'utf-8',
    )
    const fresh = new Date(Date.now() + 2_000)
    utimesSync(changed, new Date(fresh.getTime() - 1_000), new Date(fresh.getTime() - 1_000))
    utimesSync(alsoChanged, new Date(fresh.getTime() - 1_000), new Date(fresh.getTime() - 1_000))
    utimesSync(graph, fresh, fresh)

    expect(gatherTierSignals(dir, '#2180', '.claude/plans/task-2180.md')).toMatchObject({
      blastRadius: 2,
      callerCount: 0,
    })
  })
})

describe('runTaskShip deterministic widening (#2180)', () => {
  let dir: string

  beforeEach(() => {
    dir = createTestProject()
    mkdirSync(join(dir, '.claude'), { recursive: true })
  })
  afterEach(() => cleanupTestProject(dir))

  it('routes an XS override to the Standard review breadth when a Standard floor fires', () => {
    const result = runTaskShip({
      dir,
      taskId: '#2180',
      tier: 'XS',
      gatherTierSignals: () => ({ ...neutralSignals(), labels: ['wave'] }),
    })

    expect(result.tier).toBe('Standard')
    expect(result.step.reviewAgents).toBe(shipStepFor('preflight', 'Standard').reviewAgents)
    expect(result.step.verticals).toEqual(shipStepFor('preflight', 'Standard').verticals)
  })

  it('widens an XS override to Standard when qualification is absent', () => {
    const result = runTaskShip({
      dir,
      taskId: '#2180',
      tier: 'XS',
      gatherTierSignals: neutralSignals,
    })

    expect(result.tier).toBe('Standard')
    expect(result.step).toEqual(shipStepFor('preflight', 'Standard', result.profile))
  })

  it('still gathers signals for Standard so sensitive obligations cannot be skipped', () => {
    const gatherSignals = vi.fn(() => ({ ...neutralSignals(), labels: ['wave'] }))

    const result = runTaskShip({
      dir,
      taskId: '#2180',
      tier: 'Standard',
      gatherTierSignals: gatherSignals,
    })

    expect(gatherSignals).toHaveBeenCalledTimes(1)
    expect(result.tier).toBe('Standard')
    expect(result.step).toEqual(shipStepFor('preflight', 'Standard', result.profile))
  })

  it('gathers signals exactly once when an XS tier could be widened', () => {
    const gatherSignals = vi.fn(completeSignals)

    runTaskShip({
      dir,
      taskId: '#2180',
      tier: 'XS',
      gatherTierSignals: gatherSignals,
    })

    expect(gatherSignals).toHaveBeenCalledTimes(1)
  })

  it('records no-progress as BLOCKED before another implementation attempt', () => {
    expect(() =>
      runTaskShip({
        dir,
        taskId: '#2180',
        tier: 'XS',
        executionOutcome: 'no-progress',
        gatherTierSignals: completeSignals,
      }),
    ).toThrow(/BLOCKED.*no progress/i)
  })
})

// ─── #2207 / #2681: requested tiers are candidates; effective widening is durable ───
// Root cause of #2207: src/cli.ts baked `opts.tier ?? 'Standard'` at the CLI
// boundary, so the `tier` key was ALWAYS present in the patch handed to
// seedShipState -> writeUnifiedState, whose merge only preserves fields the
// patch omits. Every other call site (init, task init) omits the key when the
// flag is absent. #2184 decision: (a) human-only origination — a persisted tier
// is a human's explicit choice at `task init --tier`, so it must survive.
describe('#2207 — bare `ship <id>` respects the persisted tier', () => {
  const CLI = resolve(import.meta.dirname, '../../dist/cli.js')

  function shipDir(): string {
    const dir = mkdtempSync(join(tmpdir(), 'arbiter-2207-'))
    mkdirSync(join(dir, '.claude', '.task'), { recursive: true })
    return dir
  }

  function persistTier(dir: string, tier: string): void {
    writeFileSync(
      join(dir, '.claude', '.task', 'status.json'),
      JSON.stringify({
        taskId: '#123',
        phase: 'preflight',
        tier,
        plan: '',
        cursor: { step: 0 },
        overrides: {},
      }),
      'utf-8',
    )
  }

  function readTier(dir: string): string {
    return (
      JSON.parse(readFileSync(join(dir, '.claude', '.task', 'status.json'), 'utf-8')) as {
        tier: string
      }
    ).tier
  }

  function ship(dir: string, args: readonly string[]): string {
    const result = spawnSync(process.execPath, [CLI, 'ship', '#123', '--dir', dir, ...args], {
      encoding: 'utf-8',
      timeout: 60_000,
    })
    return result.stdout ?? ''
  }

  it('widens a persisted narrow tier when no qualifying evidence exists', () => {
    const dir = shipDir()
    try {
      persistTier(dir, 'S')
      const stdout = ship(dir, [])
      expect(stdout).toMatch(/Tier: Standard\b/)
      expect(readTier(dir)).toBe('Standard')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('persists the fail-closed Standard treatment for an unset tier', () => {
    const dir = shipDir()
    try {
      persistTier(dir, '')
      const stdout = ship(dir, [])
      expect(stdout).toMatch(/Tier: Standard\b/)
      expect(readTier(dir)).toBe('Standard')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('does not let an unqualified explicit override narrow stored treatment', () => {
    const dir = shipDir()
    try {
      persistTier(dir, 'S')
      const stdout = ship(dir, ['--tier', 'XS'])
      expect(stdout).toMatch(/Tier: Standard\b/)
      expect(readTier(dir)).toBe('Standard')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
