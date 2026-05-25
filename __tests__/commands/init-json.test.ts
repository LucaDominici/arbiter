import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { runInit } from '../../src/commands/init.js'

vi.mock('../../src/detectors/language.js', () => ({
  detectLanguage: vi.fn().mockReturnValue('typescript'),
  detectLanguageWithSource: vi
    .fn()
    .mockReturnValue({ language: 'typescript', source: 'package.json' }),
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
  detectArchetypeHint: vi.fn().mockReturnValue('library'),
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
  detectLanes: vi.fn().mockReturnValue({ lanes: [] }),
}))
vi.mock('../../src/detectors/language-hooks.js', () => ({
  getLanguageHooks: vi.fn().mockReturnValue([]),
}))
vi.mock('../../src/detectors/package.js', () => ({
  detectBasePackage: vi.fn().mockReturnValue(undefined),
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
vi.mock('../../src/github/labels.js', () => ({
  provisionLabels: vi.fn().mockReturnValue({ created: [], updated: [], skipped: [], errors: [] }),
}))
vi.mock('../../src/github/branch-protection.js', () => ({
  applyBranchProtection: vi.fn().mockReturnValue({ applied: false, error: null }),
}))
vi.mock('../../src/github/project-board.js', () => ({
  createProjectBoard: vi.fn().mockReturnValue({
    created: false,
    projectUrl: 'https://github.com/orgs/owner/projects/1',
    error: null,
    warnings: [],
  }),
}))

import { detectGitInfo } from '../../src/detectors/git.js'
import { detectGithubAccess } from '../../src/detectors/github.js'
import { provisionLabels } from '../../src/github/labels.js'

const mockDetectGitInfo = vi.mocked(detectGitInfo)
const mockDetectGithubAccess = vi.mocked(detectGithubAccess)
const mockProvisionLabels = vi.mocked(provisionLabels)

const GITHUB_GIT_INFO = {
  isGitRepo: true,
  remoteUrl: null,
  githubOwner: 'owner',
  githubRepo: 'repo',
  projectName: null,
}
const GITHUB_ACCESS = {
  available: true,
  authenticated: true,
  username: 'user',
  error: null,
}

describe('init --json', () => {
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

  it('emits JSON error and exits 1 when json=true and yes=false (wizard incompatible)', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit')
    })

    await expect(
      runInit({
        yes: false,
        tools: undefined,
        level: undefined,
        dir: '/tmp/fake',
        dryRun: false,
        brownfield: false,
        noVerify: true,
        json: true,
      }),
    ).rejects.toThrow('process.exit')

    const parsed = JSON.parse(written) as Record<string, unknown>
    expect(parsed.command).toBe('init')
    expect(parsed.status).toBe('error')
    expect(exitSpy).toHaveBeenCalledWith(1)
  })

  it('InitOptions accepts json field', () => {
    // Type check: if json is not in the interface this is a compile error
    const opts: Parameters<typeof runInit>[0] = {
      yes: true,
      tools: undefined,
      level: 'L1',
      dir: '/tmp/fake',
      dryRun: false,
      brownfield: false,
      noVerify: true,
      json: true,
    }
    expect(opts.json).toBe(true)
  })
})

describe('init --json GitHub path', () => {
  let written: string

  beforeEach(() => {
    written = ''
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
      written += String(chunk)
      return true
    })
    vi.spyOn(console, 'log').mockImplementation(() => {})
    mockDetectGitInfo.mockReturnValue(GITHUB_GIT_INFO)
    mockDetectGithubAccess.mockReturnValue(GITHUB_ACCESS)
    mockProvisionLabels.mockReturnValue({
      created: [],
      updated: [],
      skipped: [],
      errors: [],
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("emits status:'warning' with warnings[] when provisionLabels returns errors", async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((): never => {
      throw new Error('process.exit')
    })
    mockProvisionLabels.mockReturnValue({
      created: [],
      updated: [],
      skipped: [],
      errors: ['list labels failed: HTTP 401'],
    })

    await expect(
      runInit({
        yes: true,
        tools: undefined,
        level: 'L1',
        dir: '/tmp/fake',
        dryRun: false,
        brownfield: false,
        noVerify: true,
        json: true,
      }),
    ).rejects.toThrow('process.exit')

    expect(exitSpy).toHaveBeenCalledWith(1)
    const lines = written
      .trim()
      .split('\n')
      .filter((l) => l.length > 0)
    expect(lines).toHaveLength(1)
    const parsed = JSON.parse(lines[0]) as Record<string, unknown>
    expect(parsed.status).toBe('warning')
    expect(Array.isArray(parsed.warnings)).toBe(true)
    expect((parsed.warnings as string[]).some((w) => w.includes('list labels failed'))).toBe(true)
  })

  it("emits status:'ok' with no warnings key when GitHub setup succeeds", async () => {
    await runInit({
      yes: true,
      tools: undefined,
      level: 'L1',
      dir: '/tmp/fake',
      dryRun: false,
      brownfield: false,
      noVerify: true,
      json: true,
    })

    const lines = written
      .trim()
      .split('\n')
      .filter((l) => l.length > 0)
    expect(lines).toHaveLength(1)
    const parsed = JSON.parse(lines[0]) as Record<string, unknown>
    expect(parsed.status).toBe('ok')
    expect(parsed.warnings).toBeUndefined()
  })

  it('routes GitHub setup output through log wrapper in non-JSON mode', async () => {
    mockProvisionLabels.mockReturnValue({
      created: [],
      updated: [],
      skipped: [],
      errors: ['list labels failed: HTTP 401'],
    })

    await runInit({
      yes: true,
      tools: undefined,
      level: 'L1',
      dir: '/tmp/fake',
      dryRun: false,
      brownfield: false,
      noVerify: true,
      json: false,
    })

    // #820: human mode now writes via process.stdout.write captured in `written`.
    expect(written).toContain('list labels failed')
    expect(written).not.toContain('"command"')
  })
})
