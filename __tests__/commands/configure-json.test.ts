import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { runConfigure } from '../../src/commands/configure.js'
import { cleanupTestProject, createTestProject } from '../helpers.js'

vi.mock('../../src/utils/config.js', () => ({
  loadConfig: vi.fn(),
  saveConfig: vi.fn(),
}))

vi.mock('../../src/config/schema.js', () => ({
  validateConfig: vi.fn(),
}))

import { loadConfig } from '../../src/utils/config.js'
import { validateConfig } from '../../src/config/schema.js'

const mockLoadConfig = loadConfig as ReturnType<typeof vi.fn>
const mockValidateConfig = validateConfig as ReturnType<typeof vi.fn>

const BASE_CONFIG = {
  governanceLevel: 'L1',
  collaborationMode: 'trunk-solo',
  tools: ['claude'],
  permitGitHub: false,
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
  version: 2 as const,
}

describe('configure --json', () => {
  let written: string
  let dir: string

  beforeEach(() => {
    dir = createTestProject('typescript')
    written = ''
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
      written += String(chunk)
      return true
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    cleanupTestProject(dir)
  })

  it('emits JSON envelope on success', async () => {
    mockLoadConfig.mockReturnValue({ ...BASE_CONFIG })
    mockValidateConfig.mockReturnValue({ ok: true, config: BASE_CONFIG })

    await runConfigure({ dir, sets: ['permitGitHub=true'], json: true })

    const parsed = JSON.parse(written) as Record<string, unknown>
    expect(parsed.command).toBe('configure')
    expect(parsed.version).toBe('1')
    expect(parsed.status).toBe('ok')
    expect(parsed.data).toMatchObject({ updated: ['permitGitHub=true'] })
  })

  it('emits JSON error when no config found', async () => {
    mockLoadConfig.mockReturnValue(null)
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit')
    })

    await expect(runConfigure({ dir, sets: ['permitGitHub=true'], json: true })).rejects.toThrow(
      'process.exit',
    )

    const parsed = JSON.parse(written) as Record<string, unknown>
    expect(parsed.status).toBe('error')
    expect(exitSpy).toHaveBeenCalledWith(1)
  })

  it('does not emit JSON in human mode', async () => {
    mockLoadConfig.mockReturnValue({ ...BASE_CONFIG })
    mockValidateConfig.mockReturnValue({ ok: true, config: BASE_CONFIG })

    await runConfigure({ dir, sets: ['permitGitHub=false'], json: false })

    // Human mode emits text to stdout via process.stdout.write (#820), but
    // must NOT emit a JSON envelope. Assert the captured text is not JSON.
    expect(written.trim().startsWith('{')).toBe(false)
  })

  it('emits JSON error envelope on empty --set with --json (BLOCKER-9)', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit')
    })

    await expect(runConfigure({ dir, sets: [], json: true })).rejects.toThrow('process.exit')

    const parsed = JSON.parse(written) as Record<string, unknown>
    expect(parsed.command).toBe('configure')
    expect(parsed.status).toBe('error')
    expect(parsed.errors).toEqual(['--set is required (non-interactive usage)'])
    expect(exitSpy).toHaveBeenCalledWith(1)
  })
})
