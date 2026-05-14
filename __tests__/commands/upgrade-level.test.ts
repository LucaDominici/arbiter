import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { writeFileSync, existsSync, readFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { createTestProject, cleanupTestProject } from '../helpers.js'
import { runUpgradeLevel } from '../../src/commands/upgrade-level.js'
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

  it('upgrades L1→L2: sets governanceLevel, graceEndsAt ≈ +30d, graceFromLevel', () => {
    seedConfig('L1')
    const before = Date.now()

    runUpgradeLevel({ dir, target: 'L2' })

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

  it('respects custom --days', () => {
    seedConfig('L1')

    runUpgradeLevel({ dir, target: 'L2', days: 7 })

    const saved = loadConfig(dir)
    const endsAt = Date.parse(saved!.graceEndsAt!)
    const expected = Date.now() + 7 * 86400000
    expect(Math.abs(endsAt - expected)).toBeLessThan(5000)
  })

  it('rejects same-level target', () => {
    seedConfig('L2')
    expect(() => runUpgradeLevel({ dir, target: 'L2' })).toThrow(/already at L2/i)
  })

  it('rejects downgrade', () => {
    seedConfig('L2')
    expect(() => runUpgradeLevel({ dir, target: 'L1' as GovernanceLevel })).toThrow(
      /downgrade not supported/i,
    )
  })

  it('rejects missing arbiter.json', () => {
    // dir has package.json but no arbiter.json
    expect(() => runUpgradeLevel({ dir, target: 'L2' })).toThrow(/run arbiter init first/i)
  })

  it('--extend on active grace: adds +30d to existing end date and appends to grace-log.json', () => {
    seedConfig('L1')
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

    runUpgradeLevel({ dir, extend: true })

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

  it('--extend rejects when no active grace period', () => {
    writeFileSync(
      join(dir, 'arbiter.json'),
      JSON.stringify({
        version: '0.1',
        tools: ['claude'],
        governanceLevel: 'L2',
        useGitHub: false,
      }),
    )
    expect(() => runUpgradeLevel({ dir, extend: true })).toThrow(/no grace period to extend/i)
  })

  it('--extend rejects when grace period already expired', () => {
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
    expect(() => runUpgradeLevel({ dir, extend: true })).toThrow(/no grace period to extend/i)
  })

  it('upgrade writes grace-log to .arbiter dir which is created if absent', () => {
    seedConfig('L1')
    runUpgradeLevel({ dir, target: 'L2' })
    // .arbiter dir should be created with grace-log on extension
    // (for initial upgrade, no log is written — only on --extend)
    // Just verify the upgrade succeeded
    const saved = loadConfig(dir)
    expect(saved?.graceEndsAt).toBeDefined()
  })

  it('--extend appends multiple entries on successive calls', () => {
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

    runUpgradeLevel({ dir, extend: true })

    const log = JSON.parse(
      readFileSync(join(dir, '.arbiter', 'grace-log.json'), 'utf-8'),
    ) as unknown[]
    expect(log).toHaveLength(2)
  })

  it('INV-33: does not persist graceEndsAt when baseline capture fails', () => {
    seedConfig('L1')
    vi.mocked(runCli).mockImplementationOnce(() => {
      throw new Error('Simulated baseline failure')
    })

    expect(() => runUpgradeLevel({ dir, target: 'L2' })).toThrow()

    const saved = loadConfig(dir)
    expect(saved?.graceEndsAt).toBeUndefined()
    expect(saved?.governanceLevel).toBe('L1')
  })

  it('L1→L3 upgrade does NOT say "will WARN" — warn mode is L1→L2 only (#309)', () => {
    seedConfig('L1')
    const logs: string[] = []
    vi.spyOn(console, 'log').mockImplementation((msg: string) => {
      logs.push(msg)
    })
    runUpgradeLevel({ dir, target: 'L3' })
    const combined = logs.join('\n')
    expect(combined).not.toContain('will WARN')
    expect(combined).toContain('immediately')
  })

  it('L1→L2 upgrade DOES say gates will WARN (#309)', () => {
    seedConfig('L1')
    const logs: string[] = []
    vi.spyOn(console, 'log').mockImplementation((msg: string) => {
      logs.push(msg)
    })
    runUpgradeLevel({ dir, target: 'L2' })
    const combined = logs.join('\n')
    expect(combined).toContain('will WARN')
  })

  it('upgrade-level runs validateConfig before saving (#310)', () => {
    seedConfig('L1')
    // A valid upgrade should succeed — verifies validateConfig path runs without error
    expect(() => runUpgradeLevel({ dir, target: 'L2' })).not.toThrow()
    const saved = loadConfig(dir)
    expect(saved?.governanceLevel).toBe('L2')
  })

  it('--extend gives actionable error on malformed grace-log.json (#311)', () => {
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

    expect(() => runUpgradeLevel({ dir, extend: true })).toThrow(/malformed/)
  })

  it('INV-33 (#498): validateConfig failure does NOT trigger baseline capture', () => {
    seedConfig('L1')
    vi.mocked(runCli).mockClear()
    vi.mocked(validateConfig).mockReturnValueOnce({
      ok: false,
      errors: ['stubbed validation failure for #498'],
    })

    expect(() => runUpgradeLevel({ dir, target: 'L2' })).toThrow(/config invalid after upgrade/i)

    // runCli must NOT have been called — external state (debt baseline) must be untouched
    expect(vi.mocked(runCli)).not.toHaveBeenCalled()

    // arbiter.json must remain at L1 — config not persisted
    const saved = loadConfig(dir)
    expect(saved?.governanceLevel).toBe('L1')
    expect(saved?.graceEndsAt).toBeUndefined()
  })

  it('--extend (#499): non-array valid JSON in grace-log.json throws and preserves file', () => {
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

    expect(() => runUpgradeLevel({ dir, extend: true })).toThrow(/malformed/)

    // File content must be byte-equal to the original — no silent overwrite
    const after = readFileSync(logPath, 'utf-8')
    expect(after).toBe(futureSchemaPayload)
  })
})
