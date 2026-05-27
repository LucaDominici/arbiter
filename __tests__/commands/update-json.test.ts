import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runUpdate } from '../../src/commands/update.js'

vi.mock('../../src/utils/config.js', () => ({
  loadConfig: vi.fn(),
  loadSnapshot: vi.fn().mockReturnValue(null),
  saveConfigAndSnapshot: vi.fn(),
}))
vi.mock('../../src/detectors/language.js', () => ({
  detectLanguage: vi.fn().mockReturnValue('typescript'),
}))
vi.mock('../../src/detectors/build.js', () => ({
  detectBuildCommands: vi.fn().mockReturnValue({
    buildTool: 'tsc',
    buildCommand: 'tsc',
    testCommand: 'vitest',
    lintCommand: 'eslint',
    formatCommand: 'prettier',
  }),
}))
vi.mock('../../src/detectors/framework.js', () => ({
  detectFramework: vi.fn().mockReturnValue(null),
}))
vi.mock('../../src/detectors/git.js', () => ({
  detectGitInfo: vi.fn().mockReturnValue({
    isGitRepo: true,
    githubOwner: null,
    githubRepo: null,
  }),
  detectAdverseGitState: vi.fn().mockReturnValue(null),
}))
vi.mock('../../src/detectors/existing.js', () => ({
  detectExisting: vi.fn().mockReturnValue({}),
}))
vi.mock('../../src/detectors/github.js', () => ({
  detectGithubAccess: vi.fn().mockReturnValue({ authenticated: false }),
}))
vi.mock('../../src/detectors/language-hooks.js', () => ({
  getLanguageHooks: vi.fn().mockReturnValue({}),
}))
vi.mock('../../src/detectors/axis.js', () => ({
  resolveAxisFields: vi.fn().mockReturnValue({
    archetype: null,
    architectureStyle: null,
    isMultiTenant: false,
    hasDatabase: false,
    hasPublicApi: false,
    contractType: null,
    lanes: [],
  }),
}))
vi.mock('../../src/invariants/filter.js', () => ({
  presetToTiers: vi.fn().mockReturnValue([]),
  defaultPresetForLevel: vi.fn().mockReturnValue('standard'),
}))
vi.mock('../../src/config/schema.js', () => ({
  validateConfig: vi.fn(),
}))
vi.mock('../../src/config/diff.js', () => ({
  diffConfig: vi.fn().mockReturnValue({ paths: [] }),
  impactedGenerators: vi.fn().mockReturnValue(new Set()),
}))
vi.mock('../../src/generators/registry.js', () => ({
  buildRegistry: vi.fn().mockReturnValue([]),
  runGeneratorsFromRegistry: vi.fn().mockReturnValue([]),
  runGeneratorsSelective: vi.fn().mockReturnValue([]),
}))
vi.mock('../../src/commands/init.js', () => ({
  runGithubSetup: vi.fn().mockReturnValue({ warnings: [], errors: [] }),
  printResults: vi.fn(),
  runPlugins: vi.fn().mockResolvedValue([]),
}))

import { loadConfig } from '../../src/utils/config.js'
import { validateConfig } from '../../src/config/schema.js'
import { runGeneratorsFromRegistry } from '../../src/generators/registry.js'
import { runGithubSetup } from '../../src/commands/init.js'

const mockLoadConfig = loadConfig as ReturnType<typeof vi.fn>
const mockValidateConfig = validateConfig as ReturnType<typeof vi.fn>
const mockRunGeneratorsFromRegistry = vi.mocked(runGeneratorsFromRegistry)
const mockRunGithubSetup = vi.mocked(runGithubSetup)

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
  invariantTiers: [],
  version: 2 as const,
}

describe('update --json', () => {
  let written: string
  let dir: string

  beforeEach(() => {
    // Unique tmpdir per test so `.arbiter/.lock` from concurrent test workers does not collide (#614).
    dir = mkdtempSync(join(tmpdir(), 'arbiter-update-json-'))
    written = ''
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
      written += String(chunk)
      return true
    })
    vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
    rmSync(dir, { recursive: true, force: true })
  })

  it('emits JSON envelope on success', async () => {
    mockLoadConfig.mockReturnValue({ ...BASE_CONFIG })
    mockValidateConfig.mockReturnValue({ ok: true, config: BASE_CONFIG })

    await runUpdate({ dir, github: false, json: true })

    const parsed = JSON.parse(written) as Record<string, unknown>
    expect(parsed.command).toBe('update')
    expect(parsed.version).toBe('1')
    expect(parsed.status).toBe('ok')
    const data = parsed.data as Record<string, unknown>
    expect(typeof data.created).toBe('number')
    expect(typeof data.updated).toBe('number')
    expect(typeof data.skipped).toBe('number')
  })

  it('emits JSON error when validation fails', async () => {
    mockLoadConfig.mockReturnValue({ ...BASE_CONFIG })
    mockValidateConfig.mockReturnValue({
      ok: false,
      errors: ['invalid config'],
    })
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit')
    })

    await expect(runUpdate({ dir, github: false, json: true })).rejects.toThrow('process.exit')

    const parsed = JSON.parse(written) as Record<string, unknown>
    expect(parsed.status).toBe('error')
    expect(exitSpy).toHaveBeenCalledWith(2)
  })

  it('RT12: mixed generatorErrors + backendWarnings → exit 2, JSON carries both errors[] and warnings[]', async () => {
    mockLoadConfig.mockReturnValue({ ...BASE_CONFIG })
    mockValidateConfig.mockReturnValue({ ok: true, config: BASE_CONFIG })

    mockRunGeneratorsFromRegistry.mockImplementation(
      (_specs: unknown, errors: { key: string; message: string }[]) => {
        errors.push({ key: 'check-all', message: 'write failed: EACCES' })
        return []
      },
    )
    mockRunGithubSetup.mockReturnValue({ warnings: ['label 404: triage not found'] })

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit')
    })

    await expect(runUpdate({ dir, github: true, json: true })).rejects.toThrow('process.exit')

    const parsed = JSON.parse(written) as Record<string, unknown>
    expect(parsed.status).toBe('error')
    expect(exitSpy).toHaveBeenCalledWith(2)
    expect(Array.isArray(parsed.errors)).toBe(true)
    expect((parsed.errors as string[]).length).toBeGreaterThan(0)
    expect(Array.isArray(parsed.warnings)).toBe(true)
    expect((parsed.warnings as string[]).length).toBeGreaterThan(0)
  })
})
