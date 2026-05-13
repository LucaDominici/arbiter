import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { runUpdate } from '../../src/commands/update.js'

vi.mock('../../src/utils/config.js', () => ({
  loadConfig: vi.fn(),
  loadSnapshot: vi.fn().mockReturnValue(null),
  saveConfig: vi.fn(),
  saveSnapshot: vi.fn(),
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

const mockLoadConfig = loadConfig as ReturnType<typeof vi.fn>
const mockValidateConfig = validateConfig as ReturnType<typeof vi.fn>

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

  beforeEach(() => {
    written = ''
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
      written += String(chunk)
      return true
    })
    vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('emits JSON envelope on success', async () => {
    mockLoadConfig.mockReturnValue({ ...BASE_CONFIG })
    mockValidateConfig.mockReturnValue({ ok: true, config: BASE_CONFIG })

    await runUpdate({ dir: '/tmp/fake', github: false, json: true })

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

    await expect(runUpdate({ dir: '/tmp/fake', github: false, json: true })).rejects.toThrow(
      'process.exit',
    )

    const parsed = JSON.parse(written) as Record<string, unknown>
    expect(parsed.status).toBe('error')
    expect(exitSpy).toHaveBeenCalledWith(1)
  })
})
