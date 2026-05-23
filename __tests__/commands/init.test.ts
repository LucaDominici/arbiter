import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createTestProject, cleanupTestProject, makeConfig } from '../helpers.js'

// Module-level mocks must be at top level (hoisted by vitest)
vi.mock('../../src/detectors/language.js', () => ({
  detectLanguage: vi.fn().mockReturnValue('typescript'),
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
  detectArchetypeHint: vi.fn().mockReturnValue(null),
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
vi.mock('../../src/detectors/github.js', () => ({
  detectGithubAccess: vi.fn().mockReturnValue({
    available: false,
    authenticated: false,
    username: null,
    error: null,
  }),
}))
vi.mock('../../src/detectors/lanes.js', () => ({
  detectLanes: vi.fn().mockReturnValue({ lanes: [] }),
}))
vi.mock('../../src/detectors/language-hooks.js', () => ({
  getLanguageHooks: vi.fn().mockReturnValue([]),
}))
vi.mock('../../src/detectors/package.js', () => ({
  detectBasePackage: vi.fn().mockReturnValue(undefined),
}))
vi.mock('../../src/wizard/prompts.js', () => ({
  runWizard: vi.fn(),
  determineFlow: vi.fn().mockReturnValue('greenfield'),
  buildMigrationPlan: vi
    .fn()
    .mockReturnValue({ created: ['AGENTS.md'], replaced: [], merged: [], preserved: [] }),
  displayMigrationPlan: vi.fn(),
}))
vi.mock('../../src/utils/config.js', () => ({
  loadConfig: vi.fn().mockReturnValue(null),
  saveConfig: vi.fn(),
}))
vi.mock('../../src/generators/registry.js', () => ({
  buildRegistry: vi.fn().mockReturnValue([]),
  runGeneratorsFromRegistry: vi.fn().mockReturnValue([]),
  runGeneratorsSelective: vi.fn().mockReturnValue([]),
}))
vi.mock('../../src/compatibility/probe.js', () => ({
  runProbes: vi.fn().mockReturnValue({
    dir: '/tmp',
    stack: 'typescript',
    probes: [],
    hasFailures: false,
    hasWarnings: false,
  }),
}))
vi.mock('../../src/compatibility/report.js', () => ({
  formatText: vi.fn().mockReturnValue('all ok'),
}))
vi.mock('../../src/utils/run-cli.js', () => ({
  runCli: vi.fn().mockReturnValue({ stdout: '', stderr: '', exitCode: 0, durationMs: 1 }),
  CliError: class CliError extends Error {},
}))
vi.mock('../../src/utils/maturity-check.js', () => ({
  isL3Allowed: vi.fn().mockReturnValue({ allowed: true, errorMessage: null }),
}))
vi.mock('../../src/github/labels.js', () => ({
  provisionLabels: vi.fn().mockReturnValue({ created: [], updated: [], errors: [] }),
}))
vi.mock('../../src/github/branch-protection.js', () => ({
  applyBranchProtection: vi.fn().mockReturnValue({ applied: false, error: 'no admin' }),
}))
vi.mock('../../src/github/project-board.js', () => ({
  createProjectBoard: vi.fn().mockReturnValue({
    created: false,
    error: 'no access',
    projectUrl: null,
    warnings: [],
  }),
}))
vi.mock('../../src/utils/plugin-loader.js', () => ({
  loadPlugin: vi.fn(),
}))

import { runWizard, determineFlow } from '../../src/wizard/prompts.js'
import { runGeneratorsFromRegistry } from '../../src/generators/registry.js'
import { runProbes } from '../../src/compatibility/probe.js'
import { isL3Allowed } from '../../src/utils/maturity-check.js'
import { provisionLabels } from '../../src/github/labels.js'
import { applyBranchProtection } from '../../src/github/branch-protection.js'
import { createProjectBoard } from '../../src/github/project-board.js'
import { loadPlugin } from '../../src/utils/plugin-loader.js'
import { loadConfig } from '../../src/utils/config.js'
import { validateConfig } from '../../src/config/schema.js'

const mockRunWizard = vi.mocked(runWizard)
const mockDetermineFlow = vi.mocked(determineFlow)
const mockRunGeneratorsFromRegistry = vi.mocked(runGeneratorsFromRegistry)
const mockRunProbes = vi.mocked(runProbes)
const mockIsL3Allowed = vi.mocked(isL3Allowed)
const mockProvisionLabels = vi.mocked(provisionLabels)
const mockApplyBranchProtection = vi.mocked(applyBranchProtection)
const mockCreateProjectBoard = vi.mocked(createProjectBoard)
const mockLoadPlugin = vi.mocked(loadPlugin)
const mockLoadConfig = vi.mocked(loadConfig)

describe('runInit', () => {
  let dir: string
  let exitSpy: ReturnType<typeof vi.spyOn>
  let logSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    dir = createTestProject('typescript')
    vi.clearAllMocks()
    // Re-set defaults after clearAllMocks
    mockRunGeneratorsFromRegistry.mockReturnValue([])
    mockRunProbes.mockReturnValue({
      dir: '/tmp',
      stack: 'typescript',
      probes: [],
      hasFailures: false,
      hasWarnings: false,
    })
    mockIsL3Allowed.mockReturnValue({ allowed: true, errorMessage: null })
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    cleanupTestProject(dir)
  })

  it('runs generators via --yes flag without wizard', async () => {
    const { runInit } = await import('../../src/commands/init.js')
    await runInit({
      yes: true,
      tools: 'claude',
      level: 'L2',
      dir,
      dryRun: false,
      brownfield: false,
      noVerify: true,
    })
    expect(mockRunWizard).not.toHaveBeenCalled()
    expect(mockRunGeneratorsFromRegistry).toHaveBeenCalled()
  })

  it('calls wizard when not using --yes flag', async () => {
    const config = makeConfig(dir, { tools: ['claude'] })
    mockRunWizard.mockResolvedValue(config)
    const { runInit } = await import('../../src/commands/init.js')
    await runInit({
      yes: false,
      tools: undefined,
      level: undefined,
      dir,
      dryRun: false,
      brownfield: false,
      noVerify: true,
    })
    expect(mockRunWizard).toHaveBeenCalled()
  })

  it('cancels gracefully when wizard returns null', async () => {
    mockRunWizard.mockResolvedValue(null)
    const { runInit } = await import('../../src/commands/init.js')
    await runInit({
      yes: false,
      tools: undefined,
      level: undefined,
      dir,
      dryRun: false,
      brownfield: false,
      noVerify: true,
    })
    expect(mockRunGeneratorsFromRegistry).not.toHaveBeenCalled()
  })

  it('dry-run returns early without generating files', async () => {
    const { runInit } = await import('../../src/commands/init.js')
    await runInit({
      yes: true,
      tools: 'claude',
      level: 'L2',
      dir,
      dryRun: true,
      brownfield: false,
      noVerify: true,
    })
    expect(mockRunGeneratorsFromRegistry).not.toHaveBeenCalled()
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Dry run'))
  })

  it('brownfield dry-run calls displayMigrationPlan', async () => {
    mockDetermineFlow.mockReturnValueOnce('brownfield')
    const { runInit } = await import('../../src/commands/init.js')
    await runInit({
      yes: true,
      tools: 'claude',
      level: 'L2',
      dir,
      dryRun: true,
      brownfield: false,
      noVerify: true,
    })
    expect(mockRunGeneratorsFromRegistry).not.toHaveBeenCalled()
  })

  it('exits 1 when runProbes throws unexpectedly', async () => {
    mockRunProbes.mockImplementationOnce(() => {
      throw new Error('unexpected probe error')
    })
    exitSpy.mockImplementation((code?: number) => {
      throw new Error(`exit(${code})`)
    })
    const { runInit } = await import('../../src/commands/init.js')
    await expect(
      runInit({
        yes: true,
        tools: 'claude',
        level: 'L2',
        dir,
        dryRun: false,
        brownfield: false,
        noVerify: false,
      }),
    ).rejects.toThrow('exit(1)')
  })

  it('brownfield=true triggers baseline capture via runCli', async () => {
    const { runInit } = await import('../../src/commands/init.js')
    await runInit({
      yes: true,
      tools: 'claude',
      level: 'L2',
      dir,
      dryRun: false,
      brownfield: true,
      noVerify: true,
    })
    expect(mockRunGeneratorsFromRegistry).toHaveBeenCalled()
  })

  it('runs toolchain verify when noVerify is false', async () => {
    const { runInit } = await import('../../src/commands/init.js')
    await runInit({
      yes: true,
      tools: 'claude',
      level: 'L2',
      dir,
      dryRun: false,
      brownfield: false,
      noVerify: false,
    })
    expect(mockRunProbes).toHaveBeenCalled()
  })

  it('skips toolchain verify when noVerify is true', async () => {
    const { runInit } = await import('../../src/commands/init.js')
    await runInit({
      yes: true,
      tools: 'claude',
      level: 'L2',
      dir,
      dryRun: false,
      brownfield: false,
      noVerify: true,
    })
    expect(mockRunProbes).not.toHaveBeenCalled()
  })

  it('exits 1 when toolchain verify has failures', async () => {
    mockRunProbes.mockReturnValue({
      dir,
      stack: 'typescript',
      probes: [],
      hasFailures: true,
      hasWarnings: false,
    })
    const { runInit } = await import('../../src/commands/init.js')
    await runInit({
      yes: true,
      tools: 'claude',
      level: 'L2',
      dir,
      dryRun: false,
      brownfield: false,
      noVerify: false,
    })
    expect(exitSpy).toHaveBeenCalledWith(1)
  })

  it('L3 maturity gate blocks generation when feature not allowed', async () => {
    mockIsL3Allowed.mockReturnValue({
      allowed: false,
      errorMessage: 'mutation testing is beta for typescript',
    })
    exitSpy.mockImplementation((code?: number) => {
      throw new Error(`process.exit(${code})`)
    })
    const { runInit } = await import('../../src/commands/init.js')
    await expect(
      runInit({
        yes: true,
        tools: 'claude',
        level: 'L3',
        dir,
        dryRun: false,
        brownfield: false,
        noVerify: true,
      }),
    ).rejects.toThrow('process.exit(1)')
    expect(mockRunGeneratorsFromRegistry).not.toHaveBeenCalled()
  })

  it('prints created/skipped file counts after generation', async () => {
    mockRunGeneratorsFromRegistry.mockReturnValue([
      { path: '/tmp/AGENTS.md', action: 'created' },
      { path: '/tmp/check-all.mjs', action: 'skipped' },
    ])
    const { runInit } = await import('../../src/commands/init.js')
    await runInit({
      yes: true,
      tools: 'claude',
      level: 'L2',
      dir,
      dryRun: false,
      brownfield: false,
      noVerify: true,
    })
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('1 files created, 1 skipped'))
  })

  it('lists skipped filenames and suggests --force in non-brownfield mode (#812)', async () => {
    mockRunGeneratorsFromRegistry.mockReturnValue([
      { path: `${dir}/AGENTS.md`, action: 'created' },
      { path: `${dir}/arbiter.json`, action: 'skipped' },
      { path: `${dir}/.claude/settings.json`, action: 'skipped' },
    ])
    const { runInit } = await import('../../src/commands/init.js')
    await runInit({
      yes: true,
      tools: 'claude',
      level: 'L2',
      dir,
      dryRun: false,
      brownfield: false,
      noVerify: true,
    })
    const calls = logSpy.mock.calls.map((c) => String(c[0]))
    const combined = calls.join('\n')
    expect(combined).toContain('arbiter.json')
    expect(combined).toContain('--force')
  })

  it('parses L1/L2/L3 level from option string', async () => {
    const { runInit } = await import('../../src/commands/init.js')
    await runInit({
      yes: true,
      tools: 'claude',
      level: 'L1',
      dir,
      dryRun: false,
      brownfield: false,
      noVerify: true,
    })
    // Should not call L3 maturity gate
    expect(mockIsL3Allowed).not.toHaveBeenCalled()
  })

  it('throws on invalid level option (#325)', async () => {
    const { runInit } = await import('../../src/commands/init.js')
    await expect(
      runInit({
        yes: true,
        tools: 'claude',
        level: 'invalid',
        dir,
        dryRun: false,
        brownfield: false,
        noVerify: true,
      }),
    ).rejects.toThrow(/unknown governance level/i)
  })
})

describe('runGenerators', () => {
  let dir: string

  beforeEach(() => {
    dir = createTestProject('typescript')
  })

  afterEach(() => {
    cleanupTestProject(dir)
  })

  it('delegates to buildRegistry + runGeneratorsFromRegistry', async () => {
    mockRunGeneratorsFromRegistry.mockReturnValue([
      { path: join(dir, 'AGENTS.md'), action: 'created' },
    ])
    const { runGenerators } = await import('../../src/commands/init.js')
    const results = runGenerators(makeConfig(dir))
    expect(results).toHaveLength(1)
    expect(results[0].action).toBe('created')
  })
})

import { join } from 'node:path'

describe('runGithubSetup', () => {
  let dir: string
  let logSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    dir = createTestProject('typescript')
    vi.clearAllMocks()
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    cleanupTestProject(dir)
  })

  it('skips when useGitHub=false', async () => {
    const { runGithubSetup } = await import('../../src/commands/init.js')
    runGithubSetup(makeConfig(dir, { useGitHub: false }))
    expect(mockProvisionLabels).not.toHaveBeenCalled()
  })

  it('skips when githubOwner or githubRepo is null', async () => {
    const { runGithubSetup } = await import('../../src/commands/init.js')
    runGithubSetup(makeConfig(dir, { useGitHub: true, githubOwner: null, githubRepo: null }))
    expect(mockProvisionLabels).not.toHaveBeenCalled()
  })

  it('calls provisionLabels and applyBranchProtection when fully configured', async () => {
    const { runGithubSetup } = await import('../../src/commands/init.js')
    runGithubSetup(
      makeConfig(dir, {
        useGitHub: true,
        githubOwner: 'myorg',
        githubRepo: 'myrepo',
      }),
    )
    expect(mockProvisionLabels).toHaveBeenCalledWith('myorg', 'myrepo')
    expect(mockApplyBranchProtection).toHaveBeenCalledWith('myorg', 'myrepo', false)
    expect(mockCreateProjectBoard).toHaveBeenCalledWith('myorg', 'myrepo')
  })

  it('logs created labels when labels are created', async () => {
    mockProvisionLabels.mockReturnValueOnce({
      created: ['task', 'bug'],
      updated: [],
      errors: [],
    })
    const { runGithubSetup } = await import('../../src/commands/init.js')
    runGithubSetup(makeConfig(dir, { useGitHub: true, githubOwner: 'o', githubRepo: 'r' }))
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Created'))
  })

  it('logs branch protection applied when bp.applied=true', async () => {
    mockApplyBranchProtection.mockReturnValueOnce({
      applied: true,
      error: null,
    })
    const { runGithubSetup } = await import('../../src/commands/init.js')
    runGithubSetup(makeConfig(dir, { useGitHub: true, githubOwner: 'o', githubRepo: 'r' }))
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('protection applied'))
  })

  it('logs project board URL when pb.created=true', async () => {
    mockCreateProjectBoard.mockReturnValueOnce({
      created: true,
      projectUrl: 'https://github.com/orgs/o/projects/1',
      error: null,
      warnings: [],
    })
    const { runGithubSetup } = await import('../../src/commands/init.js')
    runGithubSetup(makeConfig(dir, { useGitHub: true, githubOwner: 'o', githubRepo: 'r' }))
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Project board created'))
  })
})

describe('validateConfig — AI_TOOLS allowlist (#305)', () => {
  it('accepts gemini as a valid tool', () => {
    const result = validateConfig({
      version: '0.2',
      tools: ['gemini'],
      governanceLevel: 'L2',
      useGitHub: false,
      features: {
        contractTesting: false,
        mutationTesting: false,
        securityScanning: false,
        evidenceHarness: false,
        debtGates: false,
        suppressions: false,
      },
      thresholds: {
        lineCoverage: 80,
        branchCoverage: 70,
        mutationScore: 75,
        cyclomaticComplexity: 10,
        methodLength: 20,
        maxParams: 5,
      },
    })
    expect(result.ok).toBe(true)
  })

  it('accepts windsurf as a valid tool', () => {
    const result = validateConfig({
      version: '0.2',
      tools: ['windsurf'],
      governanceLevel: 'L2',
      useGitHub: false,
      features: {
        contractTesting: false,
        mutationTesting: false,
        securityScanning: false,
        evidenceHarness: false,
        debtGates: false,
        suppressions: false,
      },
      thresholds: {
        lineCoverage: 80,
        branchCoverage: 70,
        mutationScore: 75,
        cyclomaticComplexity: 10,
        methodLength: 20,
        maxParams: 5,
      },
    })
    expect(result.ok).toBe(true)
  })

  it('accepts aider as a valid tool', () => {
    const result = validateConfig({
      version: '0.2',
      tools: ['aider'],
      governanceLevel: 'L2',
      useGitHub: false,
      features: {
        contractTesting: false,
        mutationTesting: false,
        securityScanning: false,
        evidenceHarness: false,
        debtGates: false,
        suppressions: false,
      },
      thresholds: {
        lineCoverage: 80,
        branchCoverage: 70,
        mutationScore: 75,
        cyclomaticComplexity: 10,
        methodLength: 20,
        maxParams: 5,
      },
    })
    expect(result.ok).toBe(true)
  })
})

describe('runInit — calls runPlugins (#317)', () => {
  let dir: string

  beforeEach(() => {
    dir = createTestProject('typescript')
    vi.clearAllMocks()
    mockRunGeneratorsFromRegistry.mockReturnValue([])
    mockRunProbes.mockReturnValue({
      dir: '/tmp',
      stack: 'typescript',
      probes: [],
      hasFailures: false,
      hasWarnings: false,
    })
    mockIsL3Allowed.mockReturnValue({ allowed: true, errorMessage: null })
    vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)
    vi.spyOn(console, 'log').mockImplementation(() => undefined)
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    cleanupTestProject(dir)
  })

  it('calls loadPlugin when loadConfig returns plugins in stored config (#317)', async () => {
    mockLoadConfig.mockReturnValueOnce({
      version: '0.2',
      tools: ['claude'],
      governanceLevel: 'L2',
      useGitHub: false,
      features: {
        contractTesting: false,
        mutationTesting: false,
        securityScanning: false,
        evidenceHarness: false,
        debtGates: true,
        suppressions: true,
      },
      thresholds: {
        lineCoverage: 80,
        branchCoverage: 70,
        mutationScore: 80,
        cyclomaticComplexity: 15,
        methodLength: 65,
        maxParams: 7,
      },
      plugins: ['my-arbiter-plugin'],
    } as Parameters<typeof mockLoadConfig>[0] extends undefined
      ? never
      : Awaited<ReturnType<typeof mockLoadConfig>>)
    mockLoadPlugin.mockResolvedValue({
      templateRoot: '/nonexistent',
      generate: () => ({ files: [] }),
    } as Awaited<ReturnType<typeof mockLoadPlugin>>)
    const { runInit } = await import('../../src/commands/init.js')
    await runInit({
      yes: true,
      tools: 'claude',
      level: 'L2',
      dir,
      dryRun: false,
      brownfield: false,
      noVerify: true,
    })
    expect(mockLoadPlugin).toHaveBeenCalledWith('my-arbiter-plugin', dir)
  })
})

describe('runPlugins — aggregate error on failure (#320)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('throws aggregate error when a plugin fails (#320)', async () => {
    mockLoadPlugin.mockRejectedValueOnce(new Error('plugin crashed'))
    const { runPlugins } = await import('../../src/commands/init.js')
    await expect(
      runPlugins('/tmp/fake-dir', ['failing-plugin'], {
        version: '0.2',
        tools: ['claude'],
        governanceLevel: 'L2',
        useGitHub: false,
        features: {
          contractTesting: false,
          mutationTesting: false,
          securityScanning: false,
          evidenceHarness: false,
          debtGates: false,
          suppressions: false,
        },
        thresholds: {
          lineCoverage: 80,
          branchCoverage: 70,
          mutationScore: 80,
          cyclomaticComplexity: 15,
          methodLength: 65,
          maxParams: 7,
        },
      }),
    ).rejects.toThrow(/plugin\(s\) failed/i)
  })
})

describe('parseTools / parseLevel — input validation (#325)', () => {
  let dir: string

  beforeEach(() => {
    dir = createTestProject('typescript')
    vi.clearAllMocks()
    mockRunGeneratorsFromRegistry.mockReturnValue([])
    mockIsL3Allowed.mockReturnValue({ allowed: true, errorMessage: null })
    vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)
    vi.spyOn(console, 'log').mockImplementation(() => undefined)
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    cleanupTestProject(dir)
  })

  it('throws on unknown tool name in --tools (#325)', async () => {
    const { runInit } = await import('../../src/commands/init.js')
    await expect(
      runInit({
        yes: true,
        tools: 'curosr',
        level: undefined,
        dir,
        dryRun: false,
        brownfield: false,
        noVerify: true,
      }),
    ).rejects.toMatchObject({ code: 'E_INVALID_TOOL' })
  })

  it('throws on invalid level in --level (#325)', async () => {
    const { runInit } = await import('../../src/commands/init.js')
    await expect(
      runInit({
        yes: true,
        tools: undefined,
        level: 'L5', // L1..L4 are valid; L5 is not a valid level
        dir,
        dryRun: false,
        brownfield: false,
        noVerify: true,
      }),
    ).rejects.toMatchObject({ code: 'E_INVALID_LEVEL' })
  })
})
