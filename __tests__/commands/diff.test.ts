import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createTestProject, cleanupTestProject } from '../helpers.js'

vi.mock('../../src/utils/config.js', () => ({
  loadConfig: vi.fn(),
}))
vi.mock('../../src/detectors/language.js', () => ({
  detectLanguage: vi.fn().mockReturnValue('typescript'),
  resolveLanguage: vi.fn().mockReturnValue('typescript'),
  languageSignalPresent: vi.fn().mockReturnValue(true),
}))
vi.mock('../../src/detectors/build.js', () => ({
  detectBuildCommands: vi.fn().mockReturnValue({
    buildTool: 'npm',
    buildCommand: 'npm run build',
    testCommand: 'npm test',
    lintCommand: 'npm run lint',
    formatCommand: 'npx prettier --check .',
  }),
}))
vi.mock('../../src/detectors/framework.js', () => ({
  detectFramework: vi.fn().mockReturnValue(null),
}))
vi.mock('../../src/detectors/git.js', () => ({
  detectGitInfo: vi.fn().mockReturnValue({
    isGitRepo: false,
    remoteUrl: null,
    githubOwner: null,
    githubRepo: null,
    projectName: null,
  }),
}))
vi.mock('../../src/detectors/existing.js', () => ({
  detectExisting: vi.fn().mockReturnValue({
    agentsMd: false,
    claudeDir: false,
    agentsDir: false,
    aiRulez: false,
    settingsJson: false,
    checkAllScript: false,
    geminiDir: false,
    windsurfRules: false,
    aiderConf: false,
  }),
}))
vi.mock('../../src/detectors/language-hooks.js', () => ({
  getLanguageHooks: vi.fn().mockReturnValue([]),
}))
vi.mock('../../src/detectors/axis.js', () => ({
  resolveAxisFields: vi.fn().mockReturnValue({
    archetype: 'library',
    architectureStyle: 'none',
    isMultiTenant: false,
    hasDatabase: false,
    hasPublicApi: false,
    contractType: 'none',
    lanes: [],
  }),
}))
vi.mock('../../src/utils/render.js', () => ({
  renderTemplate: vi.fn().mockReturnValue('rendered-content'),
}))

import { loadConfig } from '../../src/utils/config.js'
import { renderTemplate } from '../../src/utils/render.js'

const mockLoadConfig = vi.mocked(loadConfig)
const mockRenderTemplate = vi.mocked(renderTemplate)

function makeStoredConfig(overrides: Record<string, unknown> = {}): ReturnType<typeof loadConfig> {
  return {
    version: '0.2',
    tools: ['claude'],
    governanceLevel: 'L2',
    useGitHub: false,
    decomposition: { backend: 'markdown' },
    features: {
      debtGates: true,
      suppressions: true,
      securityScanning: true,
      mutationTesting: true,
      contractTesting: false,
      evidenceHarness: false,
    },
    thresholds: {
      coverage: 80,
      complexity: 10,
      duplication: 3,
    },
    invariantTiers: ['architectural', 'governance', 'data', 'operational'],
    archetype: 'library',
    architectureStyle: 'none',
    isMultiTenant: false,
    hasDatabase: false,
    hasPublicApi: false,
    contractType: 'none',
    ...overrides,
  } as ReturnType<typeof loadConfig>
}

describe('runDiff', () => {
  let dir: string
  let exitSpy: ReturnType<typeof vi.spyOn>
  let logSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    dir = createTestProject('typescript')
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    mockRenderTemplate.mockReturnValue('rendered-content')
  })

  afterEach(() => {
    vi.restoreAllMocks()
    cleanupTestProject(dir)
  })

  it('exits 2 (error) with message when no arbiter.json found', async () => {
    mockLoadConfig.mockReturnValue(null)
    exitSpy.mockImplementation((code?: number) => {
      throw new Error(`process.exit(${code})`)
    })
    const { runDiff } = await import('../../src/commands/diff.js')
    expect(() => runDiff({ dir })).toThrow('process.exit(2)')
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('No arbiter.json'))
  })

  it('reports new file when AGENTS.md does not exist', async () => {
    mockLoadConfig.mockReturnValue(makeStoredConfig())
    const { runDiff } = await import('../../src/commands/diff.js')
    runDiff({ dir })
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('+ AGENTS.md'))
  })

  it('reports unchanged when file content matches rendered output', async () => {
    mockLoadConfig.mockReturnValue(makeStoredConfig())
    writeFileSync(join(dir, 'AGENTS.md'), 'rendered-content')
    const { runDiff } = await import('../../src/commands/diff.js')
    runDiff({ dir })
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('= AGENTS.md'))
  })

  it('reports would-update when file content differs from rendered output', async () => {
    mockLoadConfig.mockReturnValue(makeStoredConfig())
    writeFileSync(join(dir, 'AGENTS.md'), 'old-content')
    const { runDiff } = await import('../../src/commands/diff.js')
    runDiff({ dir })
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('~ AGENTS.md'))
  })

  it('prints the run-update suggestion when the registry has new files to emit', async () => {
    // #1077: diff now enumerates the FULL generator registry (registry-dryRun),
    // not a hardcoded ~9-file subset. On a bare project the registry reports many
    // "new file" entries, so diff prints the run-`arbiter update` suggestion
    // rather than "all up to date". The all-up-to-date path (every registry file
    // byte-identical) is covered end-to-end by the wave0-reproducer F7 test.
    mockLoadConfig.mockReturnValue(
      makeStoredConfig({
        tools: [],
        invariantTiers: ['architectural', 'governance'],
      }),
    )
    const { runDiff } = await import('../../src/commands/diff.js')
    runDiff({ dir })
    const calls = logSpy.mock.calls.map((c) => String(c[0]))
    expect(calls.some((c) => c.includes('arbiter update'))).toBe(true)
    expect(calls.some((c) => c.includes('All files up to date'))).toBe(false)
  })

  it('prints update suggestion when changes detected', async () => {
    mockLoadConfig.mockReturnValue(
      makeStoredConfig({ invariantTiers: ['architectural', 'governance'] }),
    )
    const { runDiff } = await import('../../src/commands/diff.js')
    runDiff({ dir })
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('arbiter update'))
  })

  it('includes .claude/CLAUDE.md check when claude tool is enabled', async () => {
    mockLoadConfig.mockReturnValue(
      makeStoredConfig({
        tools: ['claude'],
        invariantTiers: ['architectural', 'governance'],
      }),
    )
    const { runDiff } = await import('../../src/commands/diff.js')
    runDiff({ dir })
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('.claude/CLAUDE.md'))
  })

  it('includes .agents/CODEX.md check when codex tool is enabled', async () => {
    mockLoadConfig.mockReturnValue(
      makeStoredConfig({
        tools: ['codex'],
        invariantTiers: ['architectural', 'governance'],
      }),
    )
    const { runDiff } = await import('../../src/commands/diff.js')
    runDiff({ dir })
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('.agents/CODEX.md'))
  })

  it('includes .cursorrules check when cursor tool is enabled', async () => {
    mockLoadConfig.mockReturnValue(
      makeStoredConfig({
        tools: ['cursor'],
        invariantTiers: ['architectural', 'governance'],
      }),
    )
    const { runDiff } = await import('../../src/commands/diff.js')
    runDiff({ dir })
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('.cursorrules'))
  })

  it('includes GLOBAL_INVARIANTS.md check when optional tiers present', async () => {
    mockLoadConfig.mockReturnValue(
      makeStoredConfig({
        tools: [],
        invariantTiers: ['architectural', 'governance', 'data'],
      }),
    )
    const { runDiff } = await import('../../src/commands/diff.js')
    runDiff({ dir })
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('GLOBAL_INVARIANTS.md'))
  })

  it('reports GLOBAL_INVARIANTS.md as unchanged (skipped) when no optional tiers', async () => {
    // #1077: diff runs the SAME generator registry as update (registry-dryRun),
    // so GLOBAL_INVARIANTS.md is always enumerated. With only architectural +
    // governance tiers the generator's prospective action is 'skipped' (no
    // optional-tier content to write), which diff surfaces as "unchanged" rather
    // than omitting the entry entirely (the old hardcoded behaviour). It must
    // never be reported as a new/changed file in this configuration.
    mockLoadConfig.mockReturnValue(
      makeStoredConfig({
        tools: [],
        invariantTiers: ['architectural', 'governance'],
      }),
    )
    const { runDiff } = await import('../../src/commands/diff.js')
    runDiff({ dir })
    const calls = logSpy.mock.calls.map((c) => String(c[0]))
    const globalInvLines = calls.filter((c) => c.includes('GLOBAL_INVARIANTS.md'))
    // It is enumerated, but only ever as unchanged — never new (+) or would-update (~).
    expect(globalInvLines.every((c) => c.includes('(unchanged)'))).toBe(true)
    expect(globalInvLines.some((c) => c.includes('(new file)'))).toBe(false)
    expect(globalInvLines.some((c) => c.includes('(would update)'))).toBe(false)
  })

  it('uses cwd when no dir option provided', async () => {
    mockLoadConfig.mockReturnValue(makeStoredConfig())
    const { runDiff } = await import('../../src/commands/diff.js')
    runDiff({ dir: undefined })
    expect(mockLoadConfig).toHaveBeenCalled()
  })
})
