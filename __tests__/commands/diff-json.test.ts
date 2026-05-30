import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { runDiff } from '../../src/commands/diff.js'

vi.mock('../../src/utils/config.js', () => ({
  loadConfig: vi.fn(),
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
  getFilteredInvariants: vi.fn().mockReturnValue([]),
  getInvariantsByTier: vi.fn().mockReturnValue({}),
}))
vi.mock('../../src/utils/render.js', () => ({
  renderTemplate: vi.fn().mockReturnValue('content'),
}))
// #1077: diff now runs the real generator registry (registry-dryRun), which
// calls writeFile/copyStaticFile. Spread the real module so those exist; only
// resolvedPath is overridden for deterministic paths.
vi.mock('../../src/utils/fs.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/utils/fs.js')>()
  return {
    ...actual,
    resolvedPath: vi.fn((...args: string[]) => args.join('/')),
  }
})
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return {
    ...actual,
    existsSync: vi.fn().mockReturnValue(false),
    readFileSync: vi.fn().mockReturnValue('mocked-content'),
  }
})

import { loadConfig } from '../../src/utils/config.js'
import { existsSync, readFileSync } from 'node:fs'

const mockLoadConfig = loadConfig as ReturnType<typeof vi.fn>
const mockExistsSync = existsSync as ReturnType<typeof vi.fn>
const mockReadFileSync = readFileSync as ReturnType<typeof vi.fn>

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

describe('diff --json', () => {
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

  it('emits JSON envelope with new files as warning status and exits 1 (canonical)', () => {
    mockLoadConfig.mockReturnValue({ ...BASE_CONFIG })
    // existsSync mocked false ⇒ every registry file is reported "new". The
    // registry-dryRun (#1077) therefore yields hasChanges ⇒ status 'warning'
    // ⇒ exit 1 (canonical 0/1/2 convention, INV-53).
    mockExistsSync.mockReturnValue(false)
    mockReadFileSync.mockReturnValue('mocked-content')
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((): never => {
      return undefined as never
    })

    runDiff({ dir: '/tmp/fake', json: true })

    const parsed = JSON.parse(written) as Record<string, unknown>
    expect(parsed.command).toBe('diff')
    expect(parsed.version).toBe('1')
    expect(parsed.status).toBe('warning')
    const data = parsed.data as Record<string, unknown>
    expect(data.hasChanges).toBe(true)
    expect(Array.isArray(data.files)).toBe(true)
    expect((data.files as unknown[]).length).toBeGreaterThan(0)
    expect(exitSpy).toHaveBeenCalledWith(1)
  })

  it('emits ok status when files are unchanged', () => {
    mockLoadConfig.mockReturnValue({ ...BASE_CONFIG })
    mockExistsSync.mockReturnValue(true)
    // renderTemplate returns "content"; readFileSync also returns "content" → unchanged
    mockReadFileSync.mockReturnValue('content')

    runDiff({ dir: '/tmp/fake', json: true })

    const parsed = JSON.parse(written) as Record<string, unknown>
    expect(parsed.command).toBe('diff')
    expect(parsed.version).toBe('1')
    expect(parsed.status).toBe('ok')
    const data = parsed.data as Record<string, unknown>
    expect(data.hasChanges).toBe(false)
    expect(Array.isArray(data.files)).toBe(true)
  })

  it('emits JSON error when no config found', () => {
    mockLoadConfig.mockReturnValue(null)
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit')
    })

    expect(() => runDiff({ dir: '/tmp/fake', json: true })).toThrow('process.exit')

    const parsed = JSON.parse(written) as Record<string, unknown>
    expect(parsed.status).toBe('error')
    expect(exitSpy).toHaveBeenCalledWith(2)
  })
})
