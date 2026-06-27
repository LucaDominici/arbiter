import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { runUpgradeLevel } from '../../src/commands/upgrade-level.js'

vi.mock('../../src/utils/config.js', () => ({
  loadConfig: vi.fn(),
  saveConfig: vi.fn(),
}))
vi.mock('../../src/utils/run-cli.js', () => ({
  runCli: vi.fn(),
}))
// Keep this test hermetic: it mocks node:fs partially (real openSync/writeSync,
// mocked readFileSync), which is incompatible with the real lock primitive — the
// ownership-checked deleteLock (#1636) can't read back its nonce, so the lockfile
// would leak into the real repo cwd and fail every subsequent run. This test
// exercises the --json envelope, not locking, so stub acquireLock to a no-op.
vi.mock('../../src/utils/file-lock.js', () => ({
  acquireLock: vi.fn().mockResolvedValue({
    path: '.arbiter/.lock',
    pid: process.pid,
    release: vi.fn().mockResolvedValue(undefined),
  }),
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

  it('emits JSON envelope on successful upgrade', async () => {
    mockLoadConfig.mockReturnValue({ ...BASE_CONFIG })

    await runUpgradeLevel({ target: 'L2', json: true })

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

  it('emits JSON error when no config found', async () => {
    mockLoadConfig.mockReturnValue(null)
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit')
    })

    await expect(runUpgradeLevel({ target: 'L2', json: true })).rejects.toThrow('process.exit')

    const parsed = JSON.parse(written) as Record<string, unknown>
    expect(parsed.status).toBe('error')
    expect(exitSpy).toHaveBeenCalledWith(1)
  })

  it('does not emit JSON in human mode', async () => {
    mockLoadConfig.mockReturnValue({ ...BASE_CONFIG })

    await runUpgradeLevel({ target: 'L2', json: false })

    // Human mode emits text to stdout via process.stdout.write (#820), but
    // must NOT emit a JSON envelope. Assert the captured text is not JSON.
    expect(written.trim().startsWith('{')).toBe(false)
  })

  it('emits JSON envelope on --extend path', async () => {
    const futureDate = new Date(Date.now() + 10 * 86400000).toISOString()
    mockLoadConfig.mockReturnValue({
      ...BASE_CONFIG,
      governanceLevel: 'L2' as const,
      graceEndsAt: futureDate,
    })

    await runUpgradeLevel({ extend: true, days: 7, json: true })

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
