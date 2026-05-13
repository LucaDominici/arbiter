import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { createTestProject, cleanupTestProject } from '../helpers.js'
import { runUpdate } from '../../src/commands/update.js'
import { DEFAULT_THRESHOLDS } from '../../src/config/schema.js'

function writeV2Config(dir: string, overrides: Record<string, unknown> = {}): void {
  const config = {
    version: '0.2',
    tools: ['claude'],
    governanceLevel: 'L2',
    useGitHub: false,
    features: {
      contractTesting: false,
      mutationTesting: true,
      securityScanning: true,
      evidenceHarness: false,
      debtGates: true,
      suppressions: true,
    },
    thresholds: { ...DEFAULT_THRESHOLDS.L2 },
    ...overrides,
  }
  writeFileSync(join(dir, 'arbiter.json'), JSON.stringify(config, null, 2))
}

function readArbiterJson(dir: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(dir, 'arbiter.json'), 'utf-8')) as Record<string, unknown>
}

describe('runUpdate — v2 config migration', () => {
  let dir: string

  beforeEach(() => {
    dir = createTestProject('typescript')
    vi.spyOn(console, 'log').mockImplementation(() => undefined)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    cleanupTestProject(dir)
  })

  it('migrates v1 config to v2 on disk after update', async () => {
    writeFileSync(
      join(dir, 'arbiter.json'),
      JSON.stringify({
        version: '0.1',
        tools: ['claude'],
        governanceLevel: 'L2',
        useGitHub: false,
        enableDebtGates: true,
        enableSecurityScanning: true,
      }),
    )

    await runUpdate({ dir, github: false })

    const raw = readArbiterJson(dir)
    expect(raw['version']).toBe('0.2')
    expect(raw['features']).toMatchObject({
      debtGates: true,
      securityScanning: true,
      suppressions: true,
      mutationTesting: true,
      contractTesting: false,
      evidenceHarness: false,
    })
    expect(raw['thresholds']).toMatchObject({
      lineCoverage: 80,
      branchCoverage: 70,
    })
  })

  it('persists v2 config user-set thresholds after update', async () => {
    writeV2Config(dir, {
      archetype: 'backend-web-db',
      thresholds: { ...DEFAULT_THRESHOLDS.L2, lineCoverage: 90 },
    })

    await runUpdate({ dir, github: false })

    const raw = readArbiterJson(dir)
    expect((raw['thresholds'] as Record<string, unknown>)['lineCoverage']).toBe(90)
    expect(raw['archetype']).toBe('backend-web-db')
  })
})

describe('runUpdate — selective regeneration via snapshot', () => {
  let dir: string

  beforeEach(() => {
    dir = createTestProject('typescript')
    vi.spyOn(console, 'log').mockImplementation(() => undefined)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    cleanupTestProject(dir)
  })

  it('returns keysRun=null and writes snapshot on first update', async () => {
    writeV2Config(dir)

    const result = await runUpdate({ dir, github: false })

    expect(result.keysRun).toBeNull()
    expect(existsSync(join(dir, '.arbiter-generated.json'))).toBe(true)
  })

  it('returns scoped keysRun when only one feature flag changes after first update', async () => {
    writeV2Config(dir)
    await runUpdate({ dir, github: false })

    writeV2Config(dir, {
      features: {
        contractTesting: false,
        mutationTesting: false,
        securityScanning: true,
        evidenceHarness: false,
        debtGates: true,
        suppressions: true,
      },
    })

    const result = await runUpdate({ dir, github: false })

    expect(result.keysRun).not.toBeNull()
    expect(result.keysRun?.has('mutation')).toBe(true)
    expect(result.keysRun?.has('check-all')).toBe(true)
    expect(result.keysRun?.has('nightly')).toBe(true)
    expect(result.keysRun?.has('debt-gates')).toBe(false)
    expect(result.keysRun?.has('security')).toBe(false)
    expect(result.keysRun?.has('coverage')).toBe(false)
  })

  it('returns full regen (*) when governanceLevel changes', async () => {
    writeV2Config(dir)
    await runUpdate({ dir, github: false })

    writeV2Config(dir, { governanceLevel: 'L3' })

    const result = await runUpdate({ dir, github: false })

    expect(result.keysRun?.has('*')).toBe(true)
  })

  it('returns scoped keysRun with coverage+check-all when only lineCoverage threshold changes', async () => {
    writeV2Config(dir)
    await runUpdate({ dir, github: false })

    writeV2Config(dir, {
      thresholds: { ...DEFAULT_THRESHOLDS.L2, lineCoverage: 90 },
    })

    const result = await runUpdate({ dir, github: false })

    expect(result.keysRun?.has('coverage')).toBe(true)
    expect(result.keysRun?.has('check-all')).toBe(true)
    expect(result.keysRun?.has('debt-gates')).toBe(false)
    expect(result.keysRun?.has('mutation')).toBe(false)
  })

  it('updates the snapshot file after each selective update', async () => {
    writeV2Config(dir)
    await runUpdate({ dir, github: false })

    writeV2Config(dir, {
      thresholds: { ...DEFAULT_THRESHOLDS.L2, lineCoverage: 90 },
    })

    await runUpdate({ dir, github: false })

    const snapshot = JSON.parse(
      readFileSync(join(dir, '.arbiter-generated.json'), 'utf-8'),
    ) as Record<string, unknown>

    expect((snapshot['thresholds'] as Record<string, unknown>)['lineCoverage']).toBe(90)
  })
})
