// #1659: the interactive wizard path never enriched basePackage, kotlin was excluded
// from detection, and detection read the repo root instead of the JVM root. These tests
// pin the three fixes through the public runInit entry, asserting that detectBasePackage
// (the underlying detector, mocked) is reached with the JVM root for java/kotlin/multi on
// BOTH the non-interactive and interactive paths.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { ProjectConfig } from '../../src/wizard/types.js'

vi.mock('../../src/detectors/language.js', () => ({
  detectLanguage: vi.fn().mockReturnValue('kotlin'),
  resolveLanguage: vi.fn().mockReturnValue('kotlin'),
  languageSignalPresent: vi.fn().mockReturnValue(true),
  detectLanguageWithSource: vi.fn().mockReturnValue({ language: 'kotlin', source: 'build.gradle' }),
  // #1659: detectedBasePackage now resolves the JVM root before detecting.
  jvmRoot: vi.fn((dir: string) => join(dir, 'backend')),
}))
vi.mock('../../src/detectors/build.js', () => ({
  detectBuildCommands: vi.fn().mockReturnValue({
    buildTool: 'gradle',
    buildCommand: 'gradle build',
    testCommand: 'gradle test',
    lintCommand: 'gradle check',
    formatCommand: 'gradle ktlintCheck',
  }),
}))
vi.mock('../../src/detectors/framework.js', () => ({
  detectFramework: vi.fn().mockReturnValue(null),
  detectArchetypeHint: vi.fn().mockReturnValue('backend-web-db'),
}))
vi.mock('../../src/detectors/git.js', () => ({
  detectGitInfo: vi.fn().mockReturnValue({
    isGitRepo: true,
    remoteUrl: null,
    githubOwner: null,
    githubRepo: null,
    projectName: null,
  }),
  detectAdverseGitState: vi.fn().mockReturnValue(null),
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
  detectGithubAccess: vi.fn().mockReturnValue({ authenticated: false }),
}))
vi.mock('../../src/detectors/lanes.js', () => ({
  detectLanes: vi.fn().mockReturnValue({ lanes: ['backend'] }),
}))
vi.mock('../../src/detectors/language-hooks.js', () => ({
  getLanguageHooks: vi.fn().mockReturnValue([]),
}))
vi.mock('../../src/detectors/package.js', () => ({
  detectBasePackage: vi.fn().mockReturnValue('com.example.app'),
}))
vi.mock('../../src/wizard/prompts.js', () => ({
  runWizard: vi.fn().mockResolvedValue(null),
  determineFlow: vi.fn().mockReturnValue('greenfield'),
  buildMigrationPlan: vi.fn().mockReturnValue({ created: [], updated: [], skipped: [] }),
  displayMigrationPlan: vi.fn(),
}))
vi.mock('../../src/generators/registry.js', () => ({
  buildRegistry: vi.fn().mockReturnValue([]),
  runGeneratorsFromRegistry: vi.fn().mockReturnValue([]),
}))
vi.mock('../../src/utils/config.js', () => ({
  saveConfig: vi.fn(),
  loadConfig: vi.fn().mockReturnValue(null),
}))
vi.mock('../../src/utils/maturity-check.js', () => ({
  isL3Allowed: vi.fn().mockReturnValue({ allowed: true, errorMessage: null }),
}))
vi.mock('../../src/compatibility/probe.js', () => ({
  runProbes: vi.fn().mockReturnValue({
    dir: '/tmp',
    stack: 'kotlin',
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
vi.mock('../../src/github/labels.js', () => ({
  provisionLabels: vi
    .fn()
    .mockReturnValue({ created: [], updated: [], skipped: [], errors: [], classifiedErrors: [] }),
}))

import { runInit } from '../../src/commands/init.js'
import { detectBasePackage } from '../../src/detectors/package.js'
import { jvmRoot } from '../../src/detectors/language.js'
import { saveConfig } from '../../src/utils/config.js'
import { runWizard } from '../../src/wizard/prompts.js'

const mockDetectBasePackage = vi.mocked(detectBasePackage)
const mockJvmRoot = vi.mocked(jvmRoot)
const mockSaveConfig = vi.mocked(saveConfig)
const mockRunWizard = vi.mocked(runWizard)

describe('init basePackage detection (#1659)', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'arbiter-bp-1659-'))
    vi.clearAllMocks()
    mockDetectBasePackage.mockReturnValue('com.example.app')
    mockJvmRoot.mockImplementation((d: string) => join(d, 'backend'))
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
    rmSync(dir, { recursive: true, force: true })
  })

  function lastSavedConfig(): Record<string, unknown> {
    const calls = mockSaveConfig.mock.calls
    return calls[calls.length - 1]?.[1] as unknown as Record<string, unknown>
  }

  it('non-interactive kotlin init detects basePackage against the JVM root', async () => {
    await runInit({
      yes: true,
      tools: 'claude',
      level: 'L2',
      dir,
      dryRun: false,
      brownfield: false,
      noVerify: true,
      language: 'kotlin',
      archetype: 'backend-web-db',
    })
    // #1659 fix #2 (kotlin guard) + #3 (jvmRoot): detection runs against <dir>/backend.
    expect(mockDetectBasePackage).toHaveBeenCalledWith(join(dir, 'backend'))
    expect(lastSavedConfig().basePackage).toBe('com.example.app')
  })

  it('interactive wizard path enriches basePackage when the wizard leaves it unset (#1659 fix 1)', async () => {
    const wizardConfig: ProjectConfig = {
      projectName: 'x',
      description: 'x',
      targetDir: dir,
      language: 'kotlin',
      framework: null,
      buildTool: 'gradle',
      buildCommand: 'gradle build',
      testCommand: 'gradle test',
      lintCommand: 'gradle check',
      formatCommand: 'gradle ktlintCheck',
      tools: ['claude'],
      governanceLevel: 'L2',
      useGitHub: false,
      enableDebtGates: true,
      enableSuppressions: true,
      enableSecurityScanning: true,
      invariantTiers: ['architectural'],
      archetype: 'backend-web-db',
      architectureStyle: 'hexagonal',
      isMultiTenant: false,
      hasDatabase: false,
      hasPublicApi: false,
      contractType: 'none',
      lanes: ['backend'],
      existing: {
        agentsMd: false,
        claudeDir: false,
        agentsDir: false,
        aiRulez: false,
        settingsJson: false,
        checkAllScript: false,
        geminiDir: false,
        windsurfRules: false,
        aiderConf: false,
      },
      languageHooks: [],
      // basePackage deliberately UNSET — the wizard never collects it.
    }
    mockRunWizard.mockResolvedValue(wizardConfig)

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
    // Enriched after the wizard returns → detection runs against the JVM root.
    expect(mockDetectBasePackage).toHaveBeenCalledWith(join(dir, 'backend'))
    expect(lastSavedConfig().basePackage).toBe('com.example.app')
  })
})
