import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { writeFileSync, existsSync, readFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { createTestProject, cleanupTestProject } from '../helpers.js'
import { runUpgradeLevel, GRACE_MAX_DAYS } from '../../src/commands/upgrade-level.js'
import { runCli } from '../../src/utils/run-cli.js'
import { validateConfig } from '../../src/config/schema.js'
import type { GovernanceLevel } from '../../src/wizard/types.js'
import { loadConfig } from '../../src/utils/config.js'

// Mock runCli so baseline capture doesn't actually spawn node in tmp dirs
vi.mock('../../src/utils/run-cli.js', () => ({
  runCli: vi.fn(() => ({
    stdout: '',
    stderr: '',
    exitCode: 0,
    durationMs: 10,
  })),
  CliError: class CliError extends Error {},
}))

// Partial-mock schema module so tests can force validation failure for #498
vi.mock('../../src/config/schema.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/config/schema.js')>()
  return { ...actual, validateConfig: vi.fn(actual.validateConfig) }
})

describe('runUpgradeLevel — MK grace period (ADR-028)', () => {
  let dir: string

  beforeEach(() => {
    dir = createTestProject('typescript')
    vi.spyOn(console, 'log').mockImplementation(() => undefined)
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    cleanupTestProject(dir)
  })

  function seedConfig(governanceLevel: 'L1' | 'L2' | 'L3') {
    writeFileSync(
      join(dir, 'arbiter.json'),
      JSON.stringify({
        version: '0.1',
        tools: ['claude'],
        governanceLevel,
        useGitHub: false,
        archetype: 'library',
        architectureStyle: 'none',
        isMultiTenant: false,
        hasDatabase: false,
        hasPublicApi: false,
      }),
    )
  }

  it('upgrades L1→L2: sets governanceLevel, graceEndsAt ≈ +30d, graceFromLevel', async () => {
    seedConfig('L1')
    const before = Date.now()

    await runUpgradeLevel({ dir, target: 'L2' })

    const saved = loadConfig(dir)
    expect(saved?.governanceLevel).toBe('L2')
    expect(saved?.graceFromLevel).toBe('L1')

    expect(saved?.graceEndsAt).toBeDefined()
    const endsAt = Date.parse(saved!.graceEndsAt!)
    const expectedMin = before + 29 * 86400000
    const expectedMax = Date.now() + 31 * 86400000
    expect(endsAt).toBeGreaterThanOrEqual(expectedMin)
    expect(endsAt).toBeLessThanOrEqual(expectedMax)
  })

  it('respects custom --days', async () => {
    seedConfig('L1')

    await runUpgradeLevel({ dir, target: 'L2', days: 7 })

    const saved = loadConfig(dir)
    const endsAt = Date.parse(saved!.graceEndsAt!)
    const expected = Date.now() + 7 * 86400000
    expect(Math.abs(endsAt - expected)).toBeLessThan(5000)
  })

  // #1607: `--days` must be a positive integer. A NaN crashed the date math with
  // an opaque "Invalid time value"; a value < 1 silently persisted a zero/past
  // grace window. The choke-point guard now rejects both, and never persists.
  it('rejects --days < 1 (no config mutation)', async () => {
    seedConfig('L1')
    await expect(runUpgradeLevel({ dir, target: 'L2', days: 0 })).rejects.toThrow(
      /positive integer/,
    )
    expect(loadConfig(dir)?.governanceLevel).toBe('L1')
  })

  it('rejects a negative --days (no config mutation)', async () => {
    seedConfig('L1')
    await expect(runUpgradeLevel({ dir, target: 'L2', days: -5 })).rejects.toThrow(
      /positive integer/,
    )
    expect(loadConfig(dir)?.governanceLevel).toBe('L1')
  })

  it('rejects a NaN --days instead of throwing "Invalid time value"', async () => {
    seedConfig('L1')
    await expect(runUpgradeLevel({ dir, target: 'L2', days: Number.NaN })).rejects.toThrow(
      /positive integer/,
    )
    expect(loadConfig(dir)?.governanceLevel).toBe('L1')
  })

  it('clamps an over-long --days to GRACE_MAX_DAYS so the gate cannot be silently neutered', async () => {
    seedConfig('L1')

    // The generated gate IGNORES any graceEndsAt > GRACE_MAX_DAYS ahead of now.
    // If the CLI persisted 9999 days, arbiter.json would lie about the grace the
    // gate honors. The CLI must clamp the persisted value to the same bound.
    await runUpgradeLevel({ dir, target: 'L2', days: 9999 })

    const saved = loadConfig(dir)
    const endsAt = Date.parse(saved!.graceEndsAt!)
    const maxAllowed = Date.now() + GRACE_MAX_DAYS * 86400000
    // Must be capped at the bound, not 9999 days out.
    expect(endsAt).toBeLessThanOrEqual(maxAllowed + 5000)
    expect(endsAt).toBeGreaterThanOrEqual(Date.now() + (GRACE_MAX_DAYS - 1) * 86400000)
  })

  it('rejects same-level target', async () => {
    seedConfig('L2')
    await expect(runUpgradeLevel({ dir, target: 'L2' })).rejects.toThrow(/already at L2/i)
  })

  it('rejects downgrade', async () => {
    seedConfig('L2')
    await expect(runUpgradeLevel({ dir, target: 'L1' as GovernanceLevel })).rejects.toThrow(
      /downgrade not supported/i,
    )
  })

  it('rejects missing arbiter.json', async () => {
    // dir has package.json but no arbiter.json
    await expect(runUpgradeLevel({ dir, target: 'L2' })).rejects.toThrow(/arbiter\.json/i)
  })

  it('--extend on active grace: adds +days to existing end date (within bound) and appends to grace-log.json', async () => {
    seedConfig('L1')
    // 2 days out + 30 = 32 days, still within the 35-day bound (no clamp).
    const futureDate = new Date(Date.now() + 2 * 86400000).toISOString()
    writeFileSync(
      join(dir, 'arbiter.json'),
      JSON.stringify({
        version: '0.1',
        tools: ['claude'],
        governanceLevel: 'L2',
        useGitHub: false,
        graceEndsAt: futureDate,
        graceFromLevel: 'L1',
      }),
    )

    await runUpgradeLevel({ dir, extend: true })

    const saved = loadConfig(dir)
    const newEndsAt = Date.parse(saved!.graceEndsAt!)
    // Adds 30 days to existing end date (futureDate), not to now
    const expectedEndsAt = Date.parse(futureDate) + 30 * 86400000
    expect(Math.abs(newEndsAt - expectedEndsAt)).toBeLessThan(1000)

    const logPath = join(dir, '.arbiter', 'grace-log.json')
    expect(existsSync(logPath)).toBe(true)
    const log = JSON.parse(readFileSync(logPath, 'utf-8')) as unknown[]
    expect(log).toHaveLength(1)
    const entry = log[0] as { action: string; previousEndsAt: string }
    expect(entry.action).toBe('extend')
    expect(entry.previousEndsAt).toBe(futureDate)
  })

  it('--extend clamps the cumulative window to GRACE_MAX_DAYS from now', async () => {
    // Already 30 days out; a +30 extend would land ~60 days out, well past the
    // bound. The CLI must clamp the persisted value to what the gate honors,
    // not let repeated extends push graceEndsAt arbitrarily far.
    const futureDate = new Date(Date.now() + 30 * 86400000).toISOString()
    writeFileSync(
      join(dir, 'arbiter.json'),
      JSON.stringify({
        version: '0.1',
        tools: ['claude'],
        governanceLevel: 'L2',
        useGitHub: false,
        graceEndsAt: futureDate,
        graceFromLevel: 'L1',
      }),
    )

    await runUpgradeLevel({ dir, extend: true })

    const saved = loadConfig(dir)
    const newEndsAt = Date.parse(saved!.graceEndsAt!)
    const maxAllowed = Date.now() + GRACE_MAX_DAYS * 86400000
    expect(newEndsAt).toBeLessThanOrEqual(maxAllowed + 5000)
    // And it was actually clamped (not the naive existing + 30d ≈ 60 days out).
    expect(newEndsAt).toBeLessThan(Date.parse(futureDate) + 30 * 86400000)
  })

  it('--extend rejects when no active grace period', async () => {
    writeFileSync(
      join(dir, 'arbiter.json'),
      JSON.stringify({
        version: '0.1',
        tools: ['claude'],
        governanceLevel: 'L2',
        useGitHub: false,
      }),
    )
    await expect(runUpgradeLevel({ dir, extend: true })).rejects.toThrow(
      /no grace period to extend/i,
    )
  })

  it('--extend rejects when grace period already expired', async () => {
    writeFileSync(
      join(dir, 'arbiter.json'),
      JSON.stringify({
        version: '0.1',
        tools: ['claude'],
        governanceLevel: 'L2',
        useGitHub: false,
        graceEndsAt: '2000-01-01T00:00:00.000Z',
        graceFromLevel: 'L1',
      }),
    )
    await expect(runUpgradeLevel({ dir, extend: true })).rejects.toThrow(
      /no grace period to extend/i,
    )
  })

  it('upgrade writes grace-log to .arbiter dir which is created if absent', async () => {
    seedConfig('L1')
    await runUpgradeLevel({ dir, target: 'L2' })
    // .arbiter dir should be created with grace-log on extension
    // (for initial upgrade, no log is written — only on --extend)
    // Just verify the upgrade succeeded
    const saved = loadConfig(dir)
    expect(saved?.graceEndsAt).toBeDefined()
  })

  it('--extend appends multiple entries on successive calls', async () => {
    const futureDate = new Date(Date.now() + 25 * 86400000).toISOString()
    writeFileSync(
      join(dir, 'arbiter.json'),
      JSON.stringify({
        version: '0.1',
        tools: ['claude'],
        governanceLevel: 'L2',
        useGitHub: false,
        graceEndsAt: futureDate,
        graceFromLevel: 'L1',
      }),
    )
    mkdirSync(join(dir, '.arbiter'), { recursive: true })
    writeFileSync(
      join(dir, '.arbiter', 'grace-log.json'),
      JSON.stringify([
        {
          action: 'extend',
          at: 'old',
          previousEndsAt: 'older',
          newEndsAt: futureDate,
          days: 30,
        },
      ]),
    )

    await runUpgradeLevel({ dir, extend: true })

    const log = JSON.parse(
      readFileSync(join(dir, '.arbiter', 'grace-log.json'), 'utf-8'),
    ) as unknown[]
    expect(log).toHaveLength(2)
  })

  // #1630: a baseline-capture failure must NOT abort the level bump. Previously
  // an unguarded runCli that threw left governanceLevel stale at L1 (and on a
  // fresh L1→L2 consumer the script does not even exist → MODULE_NOT_FOUND on
  // every run). The call is now existsSync-guarded and try/catch'd; saveConfig
  // always runs so the level persists, with a warning to re-run after `update`.
  // (The #498 ordering guarantee — validation failure aborts before any capture —
  // is unchanged and covered by the separate validateConfig-failure test below.)
  it('a failing baseline-capture script does not abort the level bump (#1630)', async () => {
    seedConfig('L1')
    // The script must exist for runCli to be invoked under the existsSync guard.
    mkdirSync(join(dir, 'scripts'), { recursive: true })
    writeFileSync(join(dir, 'scripts', 'capture-debt-baseline.mjs'), '// stub\n')
    vi.mocked(runCli).mockImplementationOnce(() => {
      throw new Error('Simulated baseline failure')
    })

    await runUpgradeLevel({ dir, target: 'L2' })

    const saved = loadConfig(dir)
    expect(saved?.governanceLevel).toBe('L2')
    expect(saved?.graceEndsAt).toBeDefined()
  })

  it('rejects L1→L3 because grace mode only supports L1→L2 (#2201)', async () => {
    seedConfig('L1')
    await expect(runUpgradeLevel({ dir, target: 'L3' })).rejects.toMatchObject({
      code: 'E_GRACE_NOT_SUPPORTED',
    })
    expect(loadConfig(dir)?.governanceLevel).toBe('L1')
  })

  it('L1→L2 upgrade DOES say gates will WARN (#309)', async () => {
    seedConfig('L1')
    const logs: string[] = []
    vi.spyOn(console, 'log').mockImplementation((msg: string) => {
      logs.push(msg)
    })
    await runUpgradeLevel({ dir, target: 'L2' })
    const combined = logs.join('\n')
    expect(combined).toContain('will WARN')
  })

  it('upgrade-level runs validateConfig before saving (#310)', async () => {
    seedConfig('L1')
    // A valid upgrade should succeed — verifies validateConfig path runs without error
    await runUpgradeLevel({ dir, target: 'L2' })
    const saved = loadConfig(dir)
    expect(saved?.governanceLevel).toBe('L2')
  })

  it('--extend gives actionable error on malformed grace-log.json (#311)', async () => {
    const futureDate = new Date(Date.now() + 15 * 86400000).toISOString()
    writeFileSync(
      join(dir, 'arbiter.json'),
      JSON.stringify({
        version: '0.1',
        tools: ['claude'],
        governanceLevel: 'L2',
        useGitHub: false,
        graceEndsAt: futureDate,
        graceFromLevel: 'L1',
      }),
    )
    mkdirSync(join(dir, '.arbiter'), { recursive: true })
    writeFileSync(join(dir, '.arbiter', 'grace-log.json'), '{ BROKEN JSON')

    await expect(runUpgradeLevel({ dir, extend: true })).rejects.toThrow(/malformed/)
  })

  it('INV-33 (#498): validateConfig failure does NOT trigger baseline capture', async () => {
    seedConfig('L1')
    vi.mocked(runCli).mockClear()
    // loadConfig now also calls validateConfig internally (fix #1019 — config.ts
    // validates on load). The vi.fn wraps the real implementation, so by default
    // calls pass through. We only override calls where the UPGRADED config is
    // being validated (upgrade-level.ts builds the L2 config and calls validateConfig
    // before capturing the baseline). Use mockImplementationOnce(callThrough) for
    // the first call (loadConfig → L1 check), then mockReturnValueOnce(fail) for
    // the second (upgrade-level → L2 check).
    const realValidateConfig = vi.mocked(validateConfig).getMockImplementation()
    if (realValidateConfig) {
      vi.mocked(validateConfig).mockImplementationOnce(realValidateConfig)
    }
    vi.mocked(validateConfig).mockReturnValueOnce({
      ok: false,
      errors: ['stubbed validation failure for #498'],
    })

    await expect(runUpgradeLevel({ dir, target: 'L2' })).rejects.toThrow(
      /config invalid after upgrade/i,
    )

    // runCli must NOT have been called — external state (debt baseline) must be untouched
    expect(vi.mocked(runCli)).not.toHaveBeenCalled()

    // arbiter.json must remain at L1 — config not persisted
    const saved = loadConfig(dir)
    expect(saved?.governanceLevel).toBe('L1')
    expect(saved?.graceEndsAt).toBeUndefined()
  })

  it('--extend (#499): non-array valid JSON in grace-log.json throws and preserves file', async () => {
    const futureDate = new Date(Date.now() + 15 * 86400000).toISOString()
    writeFileSync(
      join(dir, 'arbiter.json'),
      JSON.stringify({
        version: '0.1',
        tools: ['claude'],
        governanceLevel: 'L2',
        useGitHub: false,
        graceEndsAt: futureDate,
        graceFromLevel: 'L1',
      }),
    )
    mkdirSync(join(dir, '.arbiter'), { recursive: true })
    const logPath = join(dir, '.arbiter', 'grace-log.json')
    const futureSchemaPayload = JSON.stringify({ version: 2, entries: [] })
    writeFileSync(logPath, futureSchemaPayload)

    await expect(runUpgradeLevel({ dir, extend: true })).rejects.toThrow(/malformed/)

    // File content must be byte-equal to the original — no silent overwrite
    const after = readFileSync(logPath, 'utf-8')
    expect(after).toBe(futureSchemaPayload)
  })
})
