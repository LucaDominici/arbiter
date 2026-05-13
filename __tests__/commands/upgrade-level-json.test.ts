import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { runUpgradeLevel } from '../../src/commands/upgrade-level.js'

vi.mock('../../src/utils/config.js', () => ({
  loadConfig: vi.fn(),
  saveConfig: vi.fn(),
}))
vi.mock('../../src/utils/run-cli.js', () => ({
  runCli: vi.fn(),
}))
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return {
    ...actual,
    existsSync: vi.fn().mockReturnValue(false),
    mkdirSync: vi.fn(),
    readFileSync: vi.fn().mockReturnValue('[]'),
    writeFileSync: vi.fn(),
  }
})

import { loadConfig } from '../../src/utils/config.js'

const mockLoadConfig = loadConfig as ReturnType<typeof vi.fn>

const BASE_CONFIG = {
  governanceLevel: 'L1' as const,
  tools: ['claude'],
  useGitHub: false,
  features: {
    debtGates: false,
    suppressions: false,
    securityScanning: false,
    mutationTesting: false,
    contractTesting: false,
    evidenceHarness: false,
  },
  thresholds: {
    lineCoverage: 80,
    branchCoverage: 75,
    mutationScore: 60,
    cyclomaticComplexity: 10,
    methodLength: 30,
    maxParams: 4,
  },
  version: '0.1',
}

describe('upgrade-level --json', () => {
  let written: string

  beforeEach(() => {
    written = ''
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
      written += String(chunk)
      return true
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('emits JSON envelope on successful upgrade', () => {
    mockLoadConfig.mockReturnValue({ ...BASE_CONFIG })

    runUpgradeLevel({ target: 'L2', json: true })

    const parsed = JSON.parse(written) as Record<string, unknown>
    expect(parsed.command).toBe('upgrade-level')
    expect(parsed.version).toBe('1')
    expect(parsed.status).toBe('ok')
    const data = parsed.data as Record<string, unknown>
    expect(data.from).toBe('L1')
    expect(data.to).toBe('L2')
    expect(typeof data.graceEndsAt).toBe('string')
    expect(typeof data.graceDays).toBe('number')
  })

  it('emits JSON error when no config found', () => {
    mockLoadConfig.mockReturnValue(null)
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit')
    })

    expect(() => runUpgradeLevel({ target: 'L2', json: true })).toThrow('process.exit')

    const parsed = JSON.parse(written) as Record<string, unknown>
    expect(parsed.status).toBe('error')
    expect(exitSpy).toHaveBeenCalledWith(1)
  })

  it('does not emit JSON in human mode', () => {
    mockLoadConfig.mockReturnValue({ ...BASE_CONFIG })
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    runUpgradeLevel({ target: 'L2', json: false })

    expect(written).toBe('')
    consoleSpy.mockRestore()
  })

  it('emits JSON envelope on --extend path', () => {
    const futureDate = new Date(Date.now() + 10 * 86400000).toISOString()
    mockLoadConfig.mockReturnValue({
      ...BASE_CONFIG,
      governanceLevel: 'L2' as const,
      graceEndsAt: futureDate,
    })

    runUpgradeLevel({ extend: true, days: 7, json: true })

    const parsed = JSON.parse(written) as Record<string, unknown>
    expect(parsed.command).toBe('upgrade-level')
    expect(parsed.version).toBe('1')
    expect(parsed.status).toBe('ok')
    const data = parsed.data as Record<string, unknown>
    expect(data.action).toBe('extend')
    expect(typeof data.newEndsAt).toBe('string')
    expect(data.extensionDays).toBe(7)
  })
})
