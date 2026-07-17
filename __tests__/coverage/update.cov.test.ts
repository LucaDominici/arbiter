// SPDX-License-Identifier: Apache-2.0
// Branch-coverage climb for src/commands/update.ts (#1486).
// Drives runUpdate through its uncovered guards via the heavy-mock seam established
// by __tests__/commands/update-json.test.ts: every git/gh/fs/registry/init dependency
// is stubbed so the pure decision branches (adverse-state, plugin-error, selective vs
// full regen, no-config-change, json/text outcome emission, exit codes) are exercised
// deterministically with no real network, git, or filesystem mutation outside a tmpdir.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { WriteResult } from '../../src/utils/fs.js'
import type { GeneratorFailure } from '../../src/generators/registry.js'

vi.mock('../../src/utils/config.js', () => ({
  loadConfig: vi.fn(),
  loadSnapshot: vi.fn().mockReturnValue(null),
  saveConfigAndSnapshot: vi.fn(),
}))
vi.mock('../../src/detectors/git.js', () => ({
  detectAdverseGitState: vi.fn().mockReturnValue(null),
  // #1978: runUpdate now resolves projectName via resolveProjectName, which
  // consults detectGitInfo as one precedence source — stub it alongside
  // detectAdverseGitState so the mock module shape matches the real one.
  detectGitInfo: vi.fn().mockReturnValue({
    isGitRepo: true,
    remoteUrl: null,
    githubOwner: null,
    githubRepo: null,
    projectName: null,
  }),
}))
vi.mock('../../src/detectors/github.js', () => ({
  detectGithubAccess: vi.fn().mockReturnValue({ authenticated: false }),
}))
vi.mock('../../src/detectors/axis.js', () => ({
  resolveAxisFields: vi.fn().mockReturnValue({
    archetype: null,
    architectureStyle: null,
    isMultiTenant: false,
    hasDatabase: false,
    databaseEngine: null,
    hasPublicApi: false,
    contractType: null,
    lanes: [],
  }),
}))
vi.mock('../../src/integrations/skill-detector.js', () => ({
  detectInstalledSkills: vi.fn().mockReturnValue([]),
}))
vi.mock('../../src/config/resolve-project-config.js', () => ({
  resolveProjectConfig: vi.fn().mockReturnValue({
    config: { language: 'typescript', framework: null, useGitHub: false },
    detectorFields: {},
  }),
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
vi.mock('../../src/state/generated-manifest.js', () => ({
  loadGeneratedManifest: vi.fn().mockReturnValue({}),
  saveGeneratedManifest: vi.fn(),
  // #1504: update now derives unwired-guard manifest keys via manifestKey.
  manifestKey: (targetDir: string, filePath: string): string =>
    filePath.replace(`${targetDir}/`, '').replace(/\\/g, '/'),
}))
vi.mock('../../src/commands/init.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/commands/init.js')>()
  return {
    // Keep the real config-boundary slugify (#1550) — update.ts calls it.
    slugifyProjectName: actual.slugifyProjectName,
    runGithubSetup: vi.fn().mockReturnValue({ warnings: [] }),
    printResults: vi.fn(),
    runPlugins: vi.fn().mockResolvedValue([]),
  }
})

import { runUpdate, detectUnwiredGateWarning } from '../../src/commands/update.js'
import { loadConfig, loadSnapshot, saveConfigAndSnapshot } from '../../src/utils/config.js'
import { detectAdverseGitState } from '../../src/detectors/git.js'
import { detectGithubAccess } from '../../src/detectors/github.js'
import { resolveAxisFields } from '../../src/detectors/axis.js'
import { validateConfig } from '../../src/config/schema.js'
import { diffConfig, impactedGenerators } from '../../src/config/diff.js'
import {
  runGeneratorsFromRegistry,
  runGeneratorsSelective,
} from '../../src/generators/registry.js'
import { runGithubSetup, runPlugins } from '../../src/commands/init.js'

const mockLoadConfig = vi.mocked(loadConfig)
const mockLoadSnapshot = vi.mocked(loadSnapshot)
const mockDetectAdverse = vi.mocked(detectAdverseGitState)
const mockDetectGithub = vi.mocked(detectGithubAccess)
const mockResolveAxis = vi.mocked(resolveAxisFields)
const mockValidate = vi.mocked(validateConfig)
const mockDiffConfig = vi.mocked(diffConfig)
const mockImpacted = vi.mocked(impactedGenerators)
const mockRunFromRegistry = vi.mocked(runGeneratorsFromRegistry)
const mockRunSelective = vi.mocked(runGeneratorsSelective)
const mockRunGithubSetup = vi.mocked(runGithubSetup)
const mockRunPlugins = vi.mocked(runPlugins)

interface MutableConfig extends Record<string, unknown> {
  governanceLevel: 'L1' | 'L2' | 'L3'
  tools: string[]
  features: Record<string, boolean>
  version: 2
}

function baseConfig(overrides: Partial<MutableConfig> = {}): MutableConfig {
  return {
    governanceLevel: 'L1',
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
    invariantTiers: [],
    version: 2,
    ...overrides,
  }
}

function created(path: string): WriteResult {
  return { path, action: 'created' }
}

describe('update.ts branch coverage (#1486)', () => {
  let dir: string
  let stdout: string
  let stderr: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'arbiter-update-cov-'))
    stdout = ''
    stderr = ''
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown): boolean => {
      stdout += String(chunk)
      return true
    })
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk: unknown): boolean => {
      stderr += String(chunk)
      return true
    })
    vi.spyOn(console, 'log').mockImplementation((): void => {})
    // Reset module-level mocks to benign defaults each test (vi.mock is shared).
    mockLoadSnapshot.mockReturnValue(null)
    mockDetectAdverse.mockReturnValue(null)
    mockDetectGithub.mockReturnValue({ authenticated: false })
    mockResolveAxis.mockReturnValue({
      archetype: null,
      architectureStyle: null,
      isMultiTenant: false,
      hasDatabase: false,
      databaseEngine: null,
      hasPublicApi: false,
      contractType: null,
      lanes: [],
    })
    mockDiffConfig.mockReturnValue({ paths: [] })
    mockImpacted.mockReturnValue(new Set())
    mockRunFromRegistry.mockReturnValue([])
    mockRunSelective.mockReturnValue([])
    mockRunGithubSetup.mockReturnValue({ warnings: [] })
    mockRunPlugins.mockResolvedValue([])
    mockValidate.mockImplementation((raw: unknown) => ({ ok: true, config: raw as never }))
  })

  afterEach(() => {
    vi.restoreAllMocks()
    delete process.env['ARBITER_GITHUB']
    rmSync(dir, { recursive: true, force: true })
  })

  // ── detectUnwiredGateWarning: backed-up-and-replaced check script branch ──────
  it('detectUnwiredGateWarning treats a replaced check script as newly landed', () => {
    const results: WriteResult[] = [
      { path: '/p/scripts/check-x.mjs', action: 'backed-up-and-replaced' },
      { path: '/p/scripts/check-all.mjs', action: 'skipped', withheld: true },
    ]
    const warning = detectUnwiredGateWarning(results)
    expect(warning).toContain('check-x.mjs')
  })

  it('detectUnwiredGateWarning returns null for an empty result set', () => {
    expect(detectUnwiredGateWarning([])).toBeNull()
  })

  // ── runUpdate: no stored config (json + text exit 78) ─────────────────────────
  it('exits 78 with a JSON error envelope when no arbiter.json is found (json)', async () => {
    mockLoadConfig.mockReturnValue(null)
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((): never => {
      throw new Error('exit')
    })
    await expect(runUpdate({ dir, github: false, json: true })).rejects.toThrow('exit')
    expect(exitSpy).toHaveBeenCalledWith(78)
    const parsed = JSON.parse(stdout) as Record<string, unknown>
    expect(parsed.status).toBe('error')
  })

  it('exits 78 with a text hint when no arbiter.json is found (text)', async () => {
    mockLoadConfig.mockReturnValue(null)
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((): never => {
      throw new Error('exit')
    })
    await expect(runUpdate({ dir, github: false })).rejects.toThrow('exit')
    expect(exitSpy).toHaveBeenCalledWith(78)
    expect(stdout).toContain('No arbiter.json found')
  })

  // ── handleAdverseState: throw without force, warn with force ───────────────────
  it('throws UserFacingError on adverse git state without --force', async () => {
    mockLoadConfig.mockReturnValue(baseConfig())
    mockDetectAdverse.mockReturnValue({
      type: 'rebase',
      message: 'A git rebase is in progress.',
      suggestedFix: 'Complete or abort the rebase first.',
    })
    await expect(runUpdate({ dir, github: false })).rejects.toThrow(/rebase is in progress/)
  })

  it('continues (warns) on adverse git state when --force is set', async () => {
    mockLoadConfig.mockReturnValue(baseConfig())
    mockDetectAdverse.mockReturnValue({
      type: 'detached',
      message: 'Detached HEAD.',
      suggestedFix: 'Checkout a branch.',
    })
    const result = await runUpdate({ dir, github: false, force: true })
    // force path resolves to a normal completion (no throw)
    expect(result.keysRun).toBeNull()
  })

  // ── detectProjectInfo: ARBITER_GITHUB non-'1' warning + github auth branches ───
  it('warns when ARBITER_GITHUB is set to a non-"1" value', async () => {
    mockLoadConfig.mockReturnValue(baseConfig())
    process.env['ARBITER_GITHUB'] = 'yes'
    await runUpdate({ dir, github: false })
    expect(stderr).toContain('ARBITER_GITHUB=yes')
  })

  it('resolves useGitHub from authenticated access when --github is passed', async () => {
    mockLoadConfig.mockReturnValue(baseConfig())
    mockDetectGithub.mockReturnValue({ authenticated: true })
    await runUpdate({ dir, github: true })
    expect(mockDetectGithub).toHaveBeenCalled()
  })

  // ── selectAndRun: snapshot + no diff paths → no_config_changes ─────────────────
  it('prints no-config-changes and full-regens when snapshot present but diff empty', async () => {
    mockLoadConfig.mockReturnValue(baseConfig())
    mockLoadSnapshot.mockReturnValue(baseConfig() as never)
    mockDiffConfig.mockReturnValue({ paths: [] })
    const result = await runUpdate({ dir, github: false })
    expect(stdout).toContain('No config changes detected')
    expect(result.keysRun).toBeNull()
    expect(mockRunFromRegistry).toHaveBeenCalled()
  })

  // ── selectAndRun: snapshot + diff with '*' keys → reason_regen (governance) ────
  it('full-regenerates with a governance reason when impacted keys include *', async () => {
    mockLoadConfig.mockReturnValue(baseConfig())
    mockLoadSnapshot.mockReturnValue(baseConfig() as never)
    mockDiffConfig.mockReturnValue({ paths: ['governanceLevel'] })
    mockImpacted.mockReturnValue(new Set(['*']))
    const result = await runUpdate({ dir, github: false })
    expect(stdout).toContain('Governance/axis change')
    expect(result.keysRun?.has('*')).toBe(true)
  })

  // ── selectAndRun: snapshot + diff but EMPTY keys → 'Unknown config change' ─────
  it('full-regenerates with an unknown-change reason when impacted keys is empty', async () => {
    mockLoadConfig.mockReturnValue(baseConfig())
    mockLoadSnapshot.mockReturnValue(baseConfig() as never)
    mockDiffConfig.mockReturnValue({ paths: ['mysteryField'] })
    mockImpacted.mockReturnValue(new Set())
    await runUpdate({ dir, github: false })
    expect(stdout).toContain('Unknown config change')
  })

  // ── selectAndRun: snapshot + scoped keys → selective run ──────────────────────
  it('runs a selective update when impacted keys are scoped', async () => {
    mockLoadConfig.mockReturnValue(baseConfig())
    mockLoadSnapshot.mockReturnValue(baseConfig() as never)
    mockDiffConfig.mockReturnValue({ paths: ['thresholds.lineCoverage'] })
    mockImpacted.mockReturnValue(new Set(['coverage', 'check-all']))
    const result = await runUpdate({ dir, github: false })
    expect(stdout).toContain('Selective update')
    expect(result.keysRun?.has('coverage')).toBe(true)
    expect(mockRunSelective).toHaveBeenCalled()
  })

  // ── buildNextConfig: lanes present + needsMigration true ──────────────────────
  it('threads lanes and migrates soloDevMode → trunk-solo collaborationMode', async () => {
    mockLoadConfig.mockReturnValue(
      baseConfig({ features: { soloDevMode: true } }),
    )
    mockResolveAxis.mockReturnValue({
      archetype: null,
      architectureStyle: null,
      isMultiTenant: false,
      hasDatabase: false,
      databaseEngine: null,
      hasPublicApi: false,
      contractType: null,
      lanes: ['frontend', 'backend'],
    })
    await runUpdate({ dir, github: false })
    const saved = vi.mocked(saveConfigAndSnapshot).mock.calls.at(-1)
    const next = saved?.[1] as { lanes?: string[]; collaborationMode?: string }
    expect(next.lanes).toEqual(['frontend', 'backend'])
    expect(next.collaborationMode).toBe('trunk-solo')
    expect(stdout).toContain('Migrating soloDevMode')
  })

  // ── printStats / printResults: text mode with withheld + replaced + skipped ───
  it('prints a stats line including withheld files in text mode', async () => {
    mockLoadConfig.mockReturnValue(baseConfig())
    mockRunFromRegistry.mockReturnValue([
      created('/p/a.ts'),
      { path: '/p/b.ts', action: 'backed-up-and-replaced' },
      { path: '/p/c.ts', action: 'skipped' },
      { path: '/p/scripts/check-all.mjs', action: 'skipped', withheld: true },
    ])
    await runUpdate({ dir, github: false })
    expect(stdout).toContain('withheld')
  })

  // ── unwired-gate warning surfaced via text outcome ────────────────────────────
  it('surfaces the unwired-gate warning to stderr in text mode', async () => {
    mockLoadConfig.mockReturnValue(baseConfig())
    mockRunFromRegistry.mockReturnValue([
      created('/p/scripts/check-new.mjs'),
      { path: '/p/scripts/check-all.mjs', action: 'skipped', withheld: true },
    ])
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((): never => {
      throw new Error('exit')
    })
    // warnings present → emitUpdateOutcome exits with the warning code in text mode
    await expect(runUpdate({ dir, github: false })).rejects.toThrow('exit')
    expect(stderr).toContain('NOT wired')
    expect(exitSpy).toHaveBeenCalled()
  })

  // ── emitUpdateOutcome: text mode, generator errors + backend warnings ─────────
  it('reports generator failures and backend warnings then exits error (text)', async () => {
    mockLoadConfig.mockReturnValue(baseConfig())
    mockRunFromRegistry.mockImplementation((_specs: unknown, errors: GeneratorFailure[]) => {
      errors.push({ key: 'check-all', message: 'EACCES' })
      return []
    })
    mockRunGithubSetup.mockReturnValue({ warnings: ['label 404'] })
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((): never => {
      throw new Error('exit')
    })
    await expect(runUpdate({ dir, github: false })).rejects.toThrow('exit')
    expect(stdout).toContain('Generator failures')
    expect(stderr).toContain('GitHub warnings')
    expect(exitSpy).toHaveBeenCalledWith(2)
  })

  // ── emitUpdateOutcome: json mode warning-only path ────────────────────────────
  it('emits a JSON warning envelope and exits when only backend warnings exist (json)', async () => {
    mockLoadConfig.mockReturnValue(baseConfig())
    mockRunGithubSetup.mockReturnValue({ warnings: ['label 404'] })
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((): never => {
      throw new Error('exit')
    })
    await expect(runUpdate({ dir, github: false, json: true })).rejects.toThrow('exit')
    const parsed = JSON.parse(stdout) as Record<string, unknown>
    expect(parsed.status).toBe('warning')
    expect(Array.isArray(parsed.warnings)).toBe(true)
    expect(exitSpy).toHaveBeenCalled()
  })

  // ── emitUpdateOutcome: clean ok path prints verify hint (text) ────────────────
  it('prints the verify hint on a clean text-mode run', async () => {
    mockLoadConfig.mockReturnValue(baseConfig())
    await runUpdate({ dir, github: false })
    expect(stdout).toContain('to verify')
  })

  // ── validateConfig failure: json error + exit 2 ───────────────────────────────
  it('emits a JSON validation error and exits 2 when the next config is invalid (json)', async () => {
    mockLoadConfig.mockReturnValue(baseConfig())
    mockValidate.mockReturnValue({ ok: false, errors: ['bad field'] })
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((): never => {
      throw new Error('exit')
    })
    await expect(runUpdate({ dir, github: false, json: true })).rejects.toThrow('exit')
    expect(exitSpy).toHaveBeenCalledWith(2)
    const parsed = JSON.parse(stdout) as Record<string, unknown>
    expect(parsed.status).toBe('error')
  })

  it('writes a text validation error to stderr and exits 2 when invalid (text)', async () => {
    mockLoadConfig.mockReturnValue(baseConfig())
    mockValidate.mockReturnValue({ ok: false, errors: ['bad field'] })
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((): never => {
      throw new Error('exit')
    })
    await expect(runUpdate({ dir, github: false })).rejects.toThrow('exit')
    expect(exitSpy).toHaveBeenCalledWith(2)
    expect(stderr).toContain('Config invalid')
  })

  // ── handlePluginError: json (exit 2) vs non-json (FatalError) ──────────────────
  it('exits 2 with a JSON fatal envelope when a plugin throws (json)', async () => {
    mockLoadConfig.mockReturnValue(baseConfig({ plugins: ['boom'] }))
    mockRunPlugins.mockRejectedValue(new Error('plugin exploded'))
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((): never => {
      throw new Error('exit')
    })
    await expect(runUpdate({ dir, github: false, json: true })).rejects.toThrow('exit')
    expect(exitSpy).toHaveBeenCalledWith(2)
  })

  it('throws a FatalError when a plugin throws (text)', async () => {
    mockLoadConfig.mockReturnValue(baseConfig({ plugins: ['boom'] }))
    mockRunPlugins.mockRejectedValue(new Error('plugin exploded'))
    await expect(runUpdate({ dir, github: false })).rejects.toThrow('plugin exploded')
  })

  it('coerces a non-Error plugin rejection to a string message', async () => {
    mockLoadConfig.mockReturnValue(baseConfig({ plugins: ['boom'] }))
    mockRunPlugins.mockRejectedValue('string failure')
    await expect(runUpdate({ dir, github: false })).rejects.toThrow('string failure')
  })

  // ── stored.plugins not an array → empty plugin list branch ────────────────────
  it('treats a non-array plugins field as no plugins', async () => {
    mockLoadConfig.mockReturnValue(baseConfig({ plugins: 'not-an-array' }))
    const result = await runUpdate({ dir, github: false })
    expect(result.keysRun).toBeNull()
    // runPlugins still invoked, but with an empty array
    const call = mockRunPlugins.mock.calls.at(-1)
    expect(call?.[1]).toEqual([])
  })
})
