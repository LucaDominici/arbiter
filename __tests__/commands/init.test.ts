import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { createTestProject, cleanupTestProject, makeConfig } from '../helpers.js'

// Module-level mocks must be at top level (hoisted by vitest)
vi.mock('../../src/detectors/language.js', () => ({
  detectLanguage: vi.fn().mockReturnValue('typescript'),
  resolveLanguage: vi.fn().mockReturnValue('typescript'),
  languageSignalPresent: vi.fn().mockReturnValue(true),
  detectLanguageWithSource: vi
    .fn()
    .mockReturnValue({ language: 'typescript', source: 'package.json' }),
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
  isBrownfield: vi.fn().mockReturnValue(false),
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
  // #1678: the emission-plan deriver consults hasMatrixCell to drop unmodeled
  // language×dim pairs. Default to "cell exists" so the mocked isL3Allowed governs.
  hasMatrixCell: vi.fn().mockReturnValue(true),
}))
vi.mock('../../src/github/labels.js', () => ({
  provisionLabels: vi
    .fn()
    .mockReturnValue({ created: [], updated: [], errors: [], classifiedErrors: [] }),
}))
vi.mock('../../src/github/branch-protection.js', () => ({
  applyBranchProtection: vi.fn().mockReturnValue({
    applied: false,
    error: 'no admin',
    repoSettingsApplied: false,
    repoSettingsError: null,
  }),
}))
vi.mock('../../src/github/project-board.js', () => ({
  createProjectBoard: vi.fn().mockReturnValue({
    created: false,
    error: 'no access',
    projectUrl: null,
    warnings: [],
    classifiedErrors: [],
  }),
}))
vi.mock('../../src/utils/plugin-loader.js', () => ({
  loadPlugin: vi.fn(),
}))

import { runWizard, determineFlow } from '../../src/wizard/prompts.js'
import { detectLanguageWithSource } from '../../src/detectors/language.js'
import { detectGithubAccess } from '../../src/detectors/github.js'
import { runGeneratorsFromRegistry, buildRegistry } from '../../src/generators/registry.js'
import { runProbes } from '../../src/compatibility/probe.js'
import { isL3Allowed } from '../../src/utils/maturity-check.js'
import { provisionLabels } from '../../src/github/labels.js'
import { applyBranchProtection } from '../../src/github/branch-protection.js'
import { createProjectBoard } from '../../src/github/project-board.js'
import { loadPlugin } from '../../src/utils/plugin-loader.js'
import { loadConfig } from '../../src/utils/config.js'
import { runCli } from '../../src/utils/run-cli.js'
import { validateConfig } from '../../src/config/schema.js'

const mockRunWizard = vi.mocked(runWizard)
const mockDetermineFlow = vi.mocked(determineFlow)
const mockRunGeneratorsFromRegistry = vi.mocked(runGeneratorsFromRegistry)
const mockBuildRegistry = vi.mocked(buildRegistry)
const mockRunProbes = vi.mocked(runProbes)
const mockIsL3Allowed = vi.mocked(isL3Allowed)
const mockProvisionLabels = vi.mocked(provisionLabels)
const mockApplyBranchProtection = vi.mocked(applyBranchProtection)
const mockCreateProjectBoard = vi.mocked(createProjectBoard)
const mockLoadPlugin = vi.mocked(loadPlugin)
const mockLoadConfig = vi.mocked(loadConfig)
const mockRunCli = vi.mocked(runCli)
const mockDetectLanguageWithSource = vi.mocked(detectLanguageWithSource)
const mockDetectGithubAccess = vi.mocked(detectGithubAccess)

/**
 * #2434: a `--dry-run` DOES now enter the registry — that is how the preview
 * learns the 271 paths a real run writes, instead of the 3 the migration plan
 * knew about. What must still hold is that it never enters it in WRITE mode, so
 * the guarantee these dry-run cells protect is asserted on the options, not on
 * the call count. `runGeneratorsFromRegistry`'s third argument carries the mode.
 */
function expectRegistryNeverWrote(): void {
  const writeCalls = mockRunGeneratorsFromRegistry.mock.calls.filter(
    (call) => call[2]?.dryRun !== true,
  )
  expect(writeCalls).toEqual([])
}

describe('runInit', () => {
  let dir: string
  let exitSpy: ReturnType<typeof vi.spyOn>
  let logSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    dir = createTestProject('typescript')
    vi.clearAllMocks()
    // Re-set defaults after clearAllMocks
    mockRunGeneratorsFromRegistry.mockReturnValue([])
    // #1678: the L3 gate derives its checks from buildRegistry(); default to an empty
    // plan (no maturity blocks) and let the maturity-gate tests inject specs.
    mockBuildRegistry.mockReturnValue([])
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
    delete process.env['ARBITER_GITHUB']
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

  it('fails honestly before generation when language detection is unknown (AC-2132.1, AC-2132.2)', async () => {
    mockDetectLanguageWithSource.mockReturnValueOnce({ language: 'unknown', source: null })
    const { runInit } = await import('../../src/commands/init.js')

    await expect(
      runInit({
        yes: true,
        tools: 'claude',
        level: 'L1',
        dir,
        dryRun: false,
        brownfield: false,
        noVerify: true,
      }),
    ).rejects.toThrow(/unknown.*test naming.*test pyramid.*--language <lang>/i)
    expect(mockRunGeneratorsFromRegistry).not.toHaveBeenCalled()
  })

  it('keeps the recognized-language init path unchanged (AC-2132.3)', async () => {
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

    expect(mockRunGeneratorsFromRegistry).toHaveBeenCalled()
  })

  // #2315 — `--github` is an explicit request; when gh is not authenticated the
  // detector error must reach the user instead of being absorbed into a silent
  // `useGitHub:false` that drops all 8 workflow gates. RED: today init exits 0
  // with no workflows and no warning.
  it('fails loudly when --github is requested but gh is not authenticated (#2315)', async () => {
    mockDetectGithubAccess.mockReturnValue({
      available: true,
      authenticated: false,
      username: null,
      error: 'Not authenticated. Run: gh auth login',
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
        noVerify: true,
        github: true,
      }),
    ).rejects.toThrow(/Not authenticated.*gh auth login/i)
    expect(mockRunGeneratorsFromRegistry).not.toHaveBeenCalled()
  })

  it('fails loudly when --backend github is requested but gh is not authenticated (#2315)', async () => {
    mockDetectGithubAccess.mockReturnValue({
      available: true,
      authenticated: false,
      username: null,
      error: 'Not authenticated. Run: gh auth login',
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
        noVerify: true,
        backend: 'github',
      }),
    ).rejects.toThrow(/Not authenticated.*gh auth login/i)
    expect(mockRunGeneratorsFromRegistry).not.toHaveBeenCalled()
  })

  it('fails loudly when ARBITER_GITHUB=1 but gh is not authenticated (#2315)', async () => {
    mockDetectGithubAccess.mockReturnValue({
      available: true,
      authenticated: false,
      username: null,
      error: 'Not authenticated. Run: gh auth login',
    })
    process.env['ARBITER_GITHUB'] = '1'
    const { runInit } = await import('../../src/commands/init.js')

    await expect(
      runInit({
        yes: true,
        tools: 'claude',
        level: 'L2',
        dir,
        dryRun: false,
        brownfield: false,
        noVerify: true,
      }),
    ).rejects.toThrow(/Not authenticated.*gh auth login/i)
    expect(mockRunGeneratorsFromRegistry).not.toHaveBeenCalled()
  })

  it('without --github, unauthenticated gh does not block init (#2315 AC-3)', async () => {
    mockDetectGithubAccess.mockReturnValue({
      available: true,
      authenticated: false,
      username: null,
      error: 'Not authenticated. Run: gh auth login',
    })
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

    expect(mockRunGeneratorsFromRegistry).toHaveBeenCalled()
  })

  it('with authenticated gh, --github still emits workflows (#2315 AC-3)', async () => {
    mockDetectGithubAccess.mockReturnValue({
      available: true,
      authenticated: true,
      username: 'testuser',
      error: null,
    })
    const { runInit } = await import('../../src/commands/init.js')

    await runInit({
      yes: true,
      tools: 'claude',
      level: 'L2',
      dir,
      dryRun: false,
      brownfield: false,
      noVerify: true,
      github: true,
    })

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
    expectRegistryNeverWrote()
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
    expectRegistryNeverWrote()
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
        level: 'L3',
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

  it('defers TS brownfield baseline capture until npm install creates node_modules (#2202)', async () => {
    let stdout = ''
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
      stdout += String(chunk)
      return true
    })
    try {
      const { runInit } = await import('../../src/commands/init.js')
      await runInit({
        yes: true,
        tools: 'claude',
        level: 'L3',
        dir,
        dryRun: false,
        brownfield: true,
        noVerify: true,
      })

      expect(mockRunCli).not.toHaveBeenCalled()
      expect(existsSync(`${dir}/scripts/debt-baseline.json`)).toBe(false)
      expect(stdout).toContain('Debt baseline NOT captured: node_modules is absent')
      expect(stdout).toContain('Run npm install, then: node scripts/capture-debt-baseline.mjs')
      expect(exitSpy).not.toHaveBeenCalledWith(1)
    } finally {
      stdoutSpy.mockRestore()
    }
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
    // #1678: the gate derives its checks from the emission plan; inject a spec that
    // maps to a matrix dimension (mutation) so there is a capability to evaluate.
    mockBuildRegistry.mockReturnValue([{ key: 'mutation', enabled: true, run: () => [] }])
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

  // #1628: the python a11y harness (axe-playwright-python = beta) is emitted at L3 for
  // frontend-spa/backend-web-db; the L3 maturity gate must now consult a11y and block
  // without --accept-beta-tools (previously a11y was never gated).
  it('L3 gate consults a11y for a python frontend-spa init (#1628)', async () => {
    // #1678: playwright-python in the emission plan → a11y/python check derived.
    mockBuildRegistry.mockReturnValue([{ key: 'playwright-python', enabled: true, run: () => [] }])
    mockIsL3Allowed.mockImplementation((_lang, feature) =>
      feature === 'a11y'
        ? { allowed: false, errorMessage: 'axe-playwright-python is beta for python' }
        : { allowed: true, errorMessage: null },
    )
    exitSpy.mockImplementation((code?: number) => {
      throw new Error(`process.exit(${code})`)
    })
    const { runInit } = await import('../../src/commands/init.js')
    await expect(
      runInit({
        yes: true,
        tools: 'claude',
        level: 'L3',
        language: 'python',
        archetype: 'frontend-spa',
        dir,
        dryRun: false,
        brownfield: false,
        noVerify: true,
      }),
    ).rejects.toThrow('process.exit(1)')
    expect(mockIsL3Allowed).toHaveBeenCalledWith('python', 'a11y', false)
    expect(mockRunGeneratorsFromRegistry).not.toHaveBeenCalled()
  })

  // #1347: (collaborationMode × governanceLevel) coherence is enforced at the
  // pre-generation init gate — the same point as the L3 maturity gate — so a
  // CRITICAL cell is refused before any files are written (previously it slipped
  // through init and was only surfaced later by `arbiter doctor`).
  it('coherence gate blocks L4 × trunk-solo before generation (#1347)', async () => {
    exitSpy.mockImplementation((code?: number) => {
      throw new Error(`process.exit(${code})`)
    })
    const { runInit } = await import('../../src/commands/init.js')
    await expect(
      runInit({
        yes: true,
        tools: 'claude',
        level: 'L4',
        solo: true,
        dir,
        dryRun: false,
        brownfield: false,
        noVerify: true,
      }),
    ).rejects.toThrow('process.exit(1)')
    expect(mockRunGeneratorsFromRegistry).not.toHaveBeenCalled()
  })

  it('coherence gate allows L4 team (peer-review) generation (#1347)', async () => {
    const { runInit } = await import('../../src/commands/init.js')
    await runInit({
      yes: true,
      tools: 'claude',
      level: 'L4',
      dir,
      dryRun: false,
      brownfield: false,
      noVerify: true,
    })
    expect(mockRunGeneratorsFromRegistry).toHaveBeenCalled()
  })

  it('coherence gate does NOT abort on --dry-run of an incoherent cell (#1347)', async () => {
    exitSpy.mockImplementation((code?: number) => {
      throw new Error(`process.exit(${code})`)
    })
    const { runInit } = await import('../../src/commands/init.js')
    await runInit({
      yes: true,
      tools: 'claude',
      level: 'L4',
      solo: true,
      dir,
      dryRun: true,
      brownfield: false,
      noVerify: true,
    })
    expectRegistryNeverWrote()
    expect(exitSpy).not.toHaveBeenCalled()
  })

  it('language × archetype WARN does not block generation (#1347)', async () => {
    const { runInit } = await import('../../src/commands/init.js')
    await runInit({
      yes: true,
      tools: 'claude',
      level: 'L2',
      language: 'go',
      archetype: 'frontend-spa',
      dir,
      dryRun: false,
      brownfield: false,
      noVerify: true,
    })
    expect(mockRunGeneratorsFromRegistry).toHaveBeenCalled()
  })

  it('prints created/skipped file counts after generation', async () => {
    // #1491: the post-write presence check requires a `created` file to exist on
    // disk — write it so the mocked generator result reflects a real emission.
    writeFileSync(`${dir}/AGENTS.md`, 'x')
    mockRunGeneratorsFromRegistry.mockReturnValue([
      { path: `${dir}/AGENTS.md`, action: 'created' },
      { path: `${dir}/check-all.mjs`, action: 'skipped' },
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
    // #1491: the post-write presence check requires a `created` file on disk.
    writeFileSync(`${dir}/AGENTS.md`, 'x')
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
    expect(mockApplyBranchProtection).toHaveBeenCalledWith('myorg', 'myrepo', 'peer-review')
    expect(mockCreateProjectBoard).toHaveBeenCalledWith('myorg', 'myrepo', 'test-project')
  })

  it('logs created labels when labels are created', async () => {
    mockProvisionLabels.mockReturnValueOnce({
      created: ['task', 'bug'],
      updated: [],
      errors: [],
      classifiedErrors: [],
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
      classifiedErrors: [],
    })
    const { runGithubSetup } = await import('../../src/commands/init.js')
    runGithubSetup(makeConfig(dir, { useGitHub: true, githubOwner: 'o', githubRepo: 'r' }))
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Project board created'))
  })
})

describe('validateConfig — AI_TOOLS allowlist (#305)', () => {
  it('rejects gemini — retired in #2367 (ADR-119)', () => {
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
    expect(result.ok).toBe(false)
  })

  it('rejects windsurf — retired in #2367 (ADR-119)', () => {
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
    expect(result.ok).toBe(false)
  })

  it('rejects aider — retired in #2367 (ADR-119)', () => {
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
    expect(result.ok).toBe(false)
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
    // #1978: runInit now calls loadConfig twice (once for resolveProjectName's
    // precedence chain, once for the pre-overwrite plugins read) — mockReturnValue
    // (not Once) so both calls see the same stored config, matching real behavior.
    mockLoadConfig.mockReturnValue({
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

  it('rejects experimental tools — cursor is not customer-facing (ADR-095, #1362)', async () => {
    // Only claude+codex are supported via --tools; the experimental tools
    // (cursor/copilot/gemini/windsurf/aider) keep their generators but must be
    // rejected at the CLI input boundary so the advertised surface stays honest.
    const { runInit } = await import('../../src/commands/init.js')
    await expect(
      runInit({
        yes: true,
        tools: 'claude,cursor',
        level: undefined,
        dir,
        dryRun: false,
        brownfield: false,
        noVerify: true,
      }),
    ).rejects.toMatchObject({ code: 'E_INVALID_TOOL' })
  })

  it('renders E_INVALID_TOOL without doubled quotes (first-impression polish)', async () => {
    // Regression: the i18n template wrapped {tool} in quotes AND the code wrapped
    // each tool in quotes, so a newcomer who copied the website's tool list hit a
    // visibly malformed `Invalid tool: ""cursor""`. The message a first-time user
    // sees must be clean. (release-readiness init-ux gap-close)
    const { runInit } = await import('../../src/commands/init.js')
    await expect(
      runInit({
        yes: true,
        tools: 'cursor',
        level: undefined,
        dir,
        dryRun: true,
        brownfield: false,
        noVerify: true,
      }),
    ).rejects.toMatchObject({
      code: 'E_INVALID_TOOL',
      message: 'Invalid tool: "cursor". Valid tools: claude, codex',
    })
  })

  it('renders E_INVALID_TOOL for multiple bad tools with correct grammar', async () => {
    // The previous template produced `Invalid tool: ""cursor", "copilot""` — both
    // doubled-quoted and grammatically singular for a list. Each tool is quoted
    // exactly once and the noun agrees in number. (release-readiness init-ux gap-close)
    const { runInit } = await import('../../src/commands/init.js')
    await expect(
      runInit({
        yes: true,
        tools: 'cursor,copilot',
        level: undefined,
        dir,
        dryRun: true,
        brownfield: false,
        noVerify: true,
      }),
    ).rejects.toMatchObject({
      code: 'E_INVALID_TOOL',
      message: 'Invalid tools: "cursor", "copilot". Valid tools: claude, codex',
    })
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

describe('preamble detection source (#1036)', () => {
  let dir: string
  let stdoutSpy: ReturnType<typeof vi.spyOn>

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
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    cleanupTestProject(dir)
  })

  it('shows detection source in preamble when language is auto-detected from a marker', async () => {
    mockDetectLanguageWithSource.mockReturnValue({ language: 'typescript', source: 'package.json' })
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
    const output = (stdoutSpy.mock.calls as unknown[][]).map((c) => String(c[0])).join('')
    expect(output).toContain('Language: typescript (detected from package.json)')
  })

  it('shows no-markers hint in preamble when detection finds no markers', async () => {
    mockDetectLanguageWithSource.mockReturnValue({ language: 'typescript', source: null })
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
    const output = (stdoutSpy.mock.calls as unknown[][]).map((c) => String(c[0])).join('')
    expect(output).toContain('Language: typescript (no markers found)')
  })

  it('omits detection hint when --language is passed explicitly', async () => {
    const { runInit } = await import('../../src/commands/init.js')
    await runInit({
      yes: true,
      tools: 'claude',
      level: 'L2',
      dir,
      dryRun: true,
      brownfield: false,
      noVerify: true,
      language: 'rust',
    })
    const output = (stdoutSpy.mock.calls as unknown[][]).map((c) => String(c[0])).join('')
    expect(output).toContain('Language: rust')
    expect(output).not.toContain('detected from')
    expect(output).not.toContain('no markers found')
  })
})

// #1261: buildArbiterConfig must always persist the automation block so the
// Project Profile is an explicit, discoverable surface in fresh repos.
describe('buildArbiterConfig — automation persistence (#1261)', () => {
  let dir: string

  beforeEach(() => {
    dir = createTestProject('typescript')
  })

  afterEach(() => {
    cleanupTestProject(dir)
  })

  it('emits automation.autonomy=L0 when ProjectConfig.automation is absent', async () => {
    const { buildArbiterConfig } = await import('../../src/commands/init.js')
    const arbiterJson = buildArbiterConfig(makeConfig(dir))
    expect(arbiterJson.automation).toEqual({ autonomy: 'L0' })
  })

  it('preserves an explicit ProjectConfig.automation value', async () => {
    const { buildArbiterConfig } = await import('../../src/commands/init.js')
    const arbiterJson = buildArbiterConfig(makeConfig(dir, { automation: { autonomy: 'L2' } }))
    expect(arbiterJson.automation).toEqual({ autonomy: 'L2' })
  })
})

// Auto-activate git hooks on init: a fresh `arbiter init` must wire
// core.hooksPath → .githooks so the gate guards every commit WITHOUT manual
// setup — but it must never clobber a hooksPath the user already configured.
describe('runInit — git hooks auto-activation', () => {
  let dir: string

  const SET_HOOKSPATH = ['config', 'core.hooksPath', '.githooks']
  const setCalled = (): boolean =>
    mockRunCli.mock.calls.some(
      (c) =>
        c[0] === 'git' &&
        Array.isArray(c[1]) &&
        c[1].length === 3 &&
        c[1][0] === SET_HOOKSPATH[0] &&
        c[1][1] === SET_HOOKSPATH[1] &&
        c[1][2] === SET_HOOKSPATH[2],
    )

  beforeEach(() => {
    dir = createTestProject('typescript')
    // The generated tree the activation looks for.
    mkdirSync(join(dir, '.githooks'), { recursive: true })
    writeFileSync(join(dir, '.githooks', 'pre-commit'), '#!/bin/sh\n')
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
    mockRunCli.mockReturnValue({ stdout: '', stderr: '', exitCode: 0, durationMs: 1 })
    vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)
    vi.spyOn(console, 'log').mockImplementation(() => undefined)
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    cleanupTestProject(dir)
  })

  it('sets core.hooksPath=.githooks when unset', async () => {
    // `git config --get core.hooksPath` (unset) → empty stdout (default mock).
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
    expect(setCalled()).toBe(true)
  })

  it('does NOT clobber an existing external core.hooksPath', async () => {
    mockRunCli.mockImplementation((_bin, args) => {
      const a = args as string[]
      if (a.includes('--get')) {
        return { stdout: '.husky\n', stderr: '', exitCode: 0, durationMs: 1 }
      }
      return { stdout: '', stderr: '', exitCode: 0, durationMs: 1 }
    })
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
    expect(setCalled()).toBe(false)
  })
})
