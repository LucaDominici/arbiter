// SPDX-License-Identifier: Apache-2.0
//
// Branch-coverage climb for src/commands/init.ts (#1486).
// Targets the EXPORTED pure / seam functions whose conditional spreads, error
// branches, and guard early-returns are the densest uncovered region:
//   - buildArbiterConfig  (every optional-spread branch + feature flags)
//   - computeDryRunPreview
//   - rollbackGeneration  (created / backed-up / error / partial branches)
//   - printResults        (skipped / replaced / created label branches)
//   - resolveAdoptionTier (bootstrap / L1-L4 / invalid)
//   - runGenerators       (delegation)
//   - guardBrownfieldDirtyTree (clean / dirty / force / ENOENT / rethrow)
//   - runGithubSetup      (early-return guards)
//   - runPlugins          (conflict / invalid-result / path-escape / failure)
//
// Heavy detector wiring is avoided: the source functions under test take a
// ProjectConfig / WriteResult[] directly, so a real temp fixture dir + the
// makeConfig helper is all the seam we need. The github + plugin-loader modules
// ARE mocked (they shell out) so their early-return / failure branches stay
// deterministic and offline.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, readdirSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { makeConfig } from '../helpers.js'
import type { WriteResult } from '../../src/utils/fs.js'
import type { ProjectConfig } from '../../src/wizard/types.js'

// --- module mocks (only the ones that shell out / hit the network) -----------
vi.mock('../../src/github/labels.js', () => ({
  provisionLabels: vi
    .fn()
    .mockReturnValue({ created: [], updated: [], errors: [], classifiedErrors: [] }),
}))
vi.mock('../../src/github/branch-protection.js', () => ({
  applyBranchProtection: vi
    .fn()
    .mockReturnValue({ applied: false, error: null, repoSettingsError: null }),
}))
vi.mock('../../src/github/project-board.js', () => ({
  createProjectBoard: vi
    .fn()
    .mockReturnValue({ created: false, error: null, projectUrl: null, classifiedErrors: [] }),
}))
vi.mock('../../src/utils/plugin-loader.js', () => ({
  loadPlugin: vi.fn(),
}))

import { provisionLabels } from '../../src/github/labels.js'
import { loadPlugin } from '../../src/utils/plugin-loader.js'
import {
  buildArbiterConfig,
  computeDryRunPreview,
  rollbackGeneration,
  printResults,
  resolveAdoptionTier,
  runGenerators,
  guardBrownfieldDirtyTree,
  runGithubSetup,
  runPlugins,
} from '../../src/commands/init.js'

const mockProvisionLabels = vi.mocked(provisionLabels)
const mockLoadPlugin = vi.mocked(loadPlugin)

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'arbiter-init-cov-'))
  vi.clearAllMocks()
  mockProvisionLabels.mockReturnValue({
    created: [],
    updated: [],
    errors: [],
    classifiedErrors: [],
  })
})

afterEach(() => {
  vi.restoreAllMocks()
  rmSync(dir, { recursive: true, force: true })
})

// ---------------------------------------------------------------------------
describe('buildArbiterConfig — optional-spread branches', () => {
  it('emits minimal config: no optional fields, language omitted when unknown', () => {
    const cfg = makeConfig(dir, { language: 'unknown', lanes: [] })
    const out = buildArbiterConfig(cfg)
    expect(out).not.toHaveProperty('language')
    expect(out).not.toHaveProperty('lanes')
    expect(out).not.toHaveProperty('acceptBetaTools')
    expect(out).not.toHaveProperty('databaseEngine')
    expect(out).not.toHaveProperty('observability')
    expect(out).not.toHaveProperty('preset')
    expect(out.permitGitHub).toBe(false)
    expect(out.decomposition).toEqual({ backend: 'markdown' })
  })

  it('persists language when not unknown', () => {
    const out = buildArbiterConfig(makeConfig(dir, { language: 'rust' }))
    expect(out.language).toBe('rust')
  })

  it('derives github backend from useGitHub when decompositionBackend absent', () => {
    const out = buildArbiterConfig(makeConfig(dir, { useGitHub: true }))
    expect(out.decomposition).toEqual({ backend: 'github' })
    expect(out.permitGitHub).toBe(true)
  })

  it('honours an explicit decompositionBackend over useGitHub', () => {
    const out = buildArbiterConfig(
      makeConfig(dir, { useGitHub: true, decompositionBackend: 'markdown' }),
    )
    expect(out.decomposition).toEqual({ backend: 'markdown' })
  })

  it('writes databaseEngine + hasDatabase when engine defined', () => {
    const out = buildArbiterConfig(
      makeConfig(dir, { databaseEngine: 'postgresql', hasDatabase: true }),
    )
    expect(out.databaseEngine).toBe('postgresql')
    expect(out.hasDatabase).toBe(true)
  })

  it('persists every optional axis field when present', () => {
    const cfg: ProjectConfig = makeConfig(dir, {
      acceptBetaTools: true,
      evidenceRetention: { mode: 'local-last-N', count: 5 },
      thresholdProfile: 'fixed',
      strictnessTier: 'pedantic',
      industryOverlay: 'gdpr',
      basePackage: 'com.example',
      taskTiers: {
        XS: { maxLoc: 1, maxFiles: 1, requiresPlan: false, requiresAdr: false },
        S: { maxLoc: 2, maxFiles: 2, requiresPlan: false, requiresAdr: false },
        Standard: { maxLoc: 3, maxFiles: 3, requiresPlan: true, requiresAdr: true },
      },
      lanes: ['backend'],
      preset: 'industrial-grade',
      observability: { provider: 'signoz' },
      auth: { provider: 'keycloak' },
      frontend: { framework: 'vue' },
      branchingStrategy: 'github-flow',
      solo: { mergeMode: 'pr-ff' },
    })
    const out = buildArbiterConfig(cfg)
    expect(out.acceptBetaTools).toBe(true)
    expect(out.evidenceRetention).toEqual({ mode: 'local-last-N', count: 5 })
    expect(out.thresholdProfile).toBe('fixed')
    expect(out.strictnessTier).toBe('pedantic')
    expect(out.industryOverlay).toBe('gdpr')
    expect(out.basePackage).toBe('com.example')
    expect(out.taskTiers).toBeDefined()
    expect(out.lanes).toEqual(['backend'])
    expect(out.preset).toBe('industrial-grade')
    expect(out.observability).toEqual({ provider: 'signoz' })
    expect(out.auth).toEqual({ provider: 'keycloak' })
    expect(out.frontend).toEqual({ framework: 'vue' })
    expect(out.branchingStrategy).toBe('github-flow')
    expect(out.solo).toEqual({ mergeMode: 'pr-ff' })
  })

  it('omits industryOverlay when it is "none"', () => {
    const out = buildArbiterConfig(makeConfig(dir, { industryOverlay: 'none' }))
    expect(out).not.toHaveProperty('industryOverlay')
  })

  // #1616 — deployTarget + taxonomy must be persisted so `arbiter update`/`diff`
  // re-emit deploy workflows/infra and custom test-taxonomy dims (previously dropped).
  it('persists deployTarget and taxonomy when present (#1616)', () => {
    const out = buildArbiterConfig(
      makeConfig(dir, {
        deployTarget: 'azure-container-app',
        taxonomy: { domainDims: ['billing', 'fraud'] },
      }),
    )
    expect(out.deployTarget).toBe('azure-container-app')
    expect(out.taxonomy).toEqual({ domainDims: ['billing', 'fraud'] })
  })

  it('omits deployTarget when it is "none" (#1616)', () => {
    const out = buildArbiterConfig(makeConfig(dir, { deployTarget: 'none' }))
    expect(out).not.toHaveProperty('deployTarget')
  })

  it('omits preset when it is "none"', () => {
    const out = buildArbiterConfig(makeConfig(dir, { preset: 'none' }))
    expect(out).not.toHaveProperty('preset')
  })

  it('feature flags: mutation/contract/evidence/selfValidation defaults derive correctly', () => {
    const out = buildArbiterConfig(
      makeConfig(dir, {
        enableMutationTesting: false,
        enableContractTesting: false,
        enableEvidenceHarness: false,
        enableSelfValidationHarness: false,
        enableSoloDevMode: false,
      }),
    )
    expect(out.features.mutationTesting).toBe(false)
    expect(out.features.contractTesting).toBe(false)
    expect(out.features.evidenceHarness).toBe(false)
    expect(out.features.selfValidationHarness).toBe(false)
    expect(out.features.soloDevMode).toBe(false)
  })

  it('feature flags: explicit-true variants flip the derived booleans', () => {
    const out = buildArbiterConfig(
      makeConfig(dir, {
        enableMutationTesting: true,
        enableContractTesting: true,
        enableEvidenceHarness: true,
        enableSelfValidationHarness: true,
        enableSoloDevMode: true,
      }),
    )
    expect(out.features.mutationTesting).toBe(true)
    expect(out.features.contractTesting).toBe(true)
    expect(out.features.evidenceHarness).toBe(true)
    expect(out.features.selfValidationHarness).toBe(true)
    expect(out.features.soloDevMode).toBe(true)
  })

  it('falls back to DEFAULT_THRESHOLDS when thresholds undefined', () => {
    const out = buildArbiterConfig(makeConfig(dir, { thresholds: undefined }))
    expect(out.thresholds).toBeDefined()
    expect(typeof out.thresholds?.lineCoverage).toBe('number')
  })
})

// ---------------------------------------------------------------------------
describe('computeDryRunPreview', () => {
  // #2452: the preview is now a projection of the real generator plan run dry, so
  // these assert the projection's shape — the preview-equals-plan RELATIONSHIP is
  // pinned in __tests__/commands/init-dryrun-plan-parity.test.ts.
  it('returns created/modified/skipped buckets of real target-relative paths', async () => {
    const preview = await computeDryRunPreview(makeConfig(dir))
    expect(Array.isArray(preview.created)).toBe(true)
    expect(Array.isArray(preview.modified)).toBe(true)
    expect(Array.isArray(preview.skipped)).toBe(true)
    expect(preview.created).toContain('AGENTS.md')
    for (const entry of preview.created) expect(entry.startsWith('/')).toBe(false)
  }, 120_000)

  it('writes nothing — a dry run must not perform the side effects it previews', async () => {
    const probe = mkdtempSync(join(tmpdir(), 'arbiter-init-cov-dry-'))
    try {
      await computeDryRunPreview(makeConfig(probe, { useGitHub: true }))
      expect(existsSync(join(probe, 'AGENTS.md'))).toBe(false)
      expect(readdirSync(probe)).toEqual([])
    } finally {
      rmSync(probe, { recursive: true, force: true })
    }
  }, 120_000)
})

// ---------------------------------------------------------------------------
describe('rollbackGeneration', () => {
  it('removes a created file that still exists on disk', () => {
    const f = join(dir, 'created.txt')
    writeFileSync(f, 'x')
    rollbackGeneration([{ path: f, action: 'created' }])
    expect(existsSync(f)).toBe(false)
  })

  it('no-ops for a created file that was already gone (existsSync false branch)', () => {
    const f = join(dir, 'absent.txt')
    expect(() => rollbackGeneration([{ path: f, action: 'created' }])).not.toThrow()
  })

  it('restores a backed-up-and-replaced file from its .arbiter-backup', () => {
    const f = join(dir, 'replaced.txt')
    const backup = `${f}.arbiter-backup`
    writeFileSync(f, 'NEW')
    writeFileSync(backup, 'ORIGINAL')
    rollbackGeneration([{ path: f, action: 'backed-up-and-replaced' }])
    expect(existsSync(backup)).toBe(false)
  })

  it('no-ops a backed-up-and-replaced entry whose backup is missing', () => {
    const f = join(dir, 'no-backup.txt')
    writeFileSync(f, 'NEW')
    expect(() =>
      rollbackGeneration([{ path: f, action: 'backed-up-and-replaced' }]),
    ).not.toThrow()
  })

  it('ignores actions that are neither created nor backed-up (skipped/replaced)', () => {
    const results: WriteResult[] = [
      { path: join(dir, 'a'), action: 'skipped' },
      { path: join(dir, 'b'), action: 'replaced' },
      { path: join(dir, 'c'), action: 'dry-run' },
    ]
    expect(() => rollbackGeneration(results)).not.toThrow()
  })

  it('collects a rollback error and writes the partial-cleanup notice (error branch)', () => {
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    // A directory cannot be removed by unlinkSync → throws EISDIR/EPERM, hitting
    // the catch + rollbackErrors path.
    const asDir = join(dir, 'is-a-dir')
    mkdirSync(asDir)
    rollbackGeneration([{ path: asDir, action: 'created' }])
    const out = stderrSpy.mock.calls.map((c) => String(c[0])).join('')
    expect(out).toContain('Rollback partial')
  })
})

// ---------------------------------------------------------------------------
describe('printResults — label branches', () => {
  it('prints created / skipped / backed-up label variants', () => {
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    const results: WriteResult[] = [
      { path: `${dir}/AGENTS.md`, action: 'created' },
      { path: `${dir}/arbiter.json`, action: 'skipped' },
      { path: `${dir}/settings.json`, action: 'backed-up-and-replaced' },
      { path: `${dir}/other.txt`, action: 'replaced' },
    ]
    printResults(results, dir)
    const out = stdoutSpy.mock.calls.map((c) => String(c[0])).join('')
    expect(out).toContain('AGENTS.md')
    expect(out).toContain('arbiter.json')
    expect(out).toContain('settings.json')
  })

  it('handles an empty result list without output', () => {
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    printResults([], dir)
    expect(stdoutSpy).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
describe('resolveAdoptionTier', () => {
  it('bootstrap → L1 + brownfield baseline', () => {
    expect(resolveAdoptionTier('bootstrap')).toEqual({
      governanceLevel: 'L1',
      brownfield: true,
    })
  })

  it.each(['L1', 'L2', 'L3', 'L4'] as const)(
    '%s alias → that level, no brownfield',
    (lvl) => {
      expect(resolveAdoptionTier(lvl)).toEqual({ governanceLevel: lvl, brownfield: false })
    },
  )

  it('throws E_INVALID_LEVEL on an unknown tier', () => {
    expect(() => resolveAdoptionTier('mega')).toThrowError()
  })
})

// ---------------------------------------------------------------------------
describe('runGenerators — delegation', () => {
  it('returns the WriteResult[] produced by the registry run', () => {
    // No detectors are invoked: buildRegistry is driven by the passed config.
    const results = runGenerators(makeConfig(dir))
    expect(Array.isArray(results)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
describe('guardBrownfieldDirtyTree — git status branches', () => {
  function initRepo(at: string): void {
    execFileSync('git', ['init', '-q'], { cwd: at })
    execFileSync('git', ['config', 'user.email', 't@t.dev'], { cwd: at })
    execFileSync('git', ['config', 'user.name', 't'], { cwd: at })
  }

  it('returns silently on a clean tree (porcelain empty)', () => {
    initRepo(dir)
    expect(() => guardBrownfieldDirtyTree(dir, false)).not.toThrow()
  })

  it('throws E_INIT_DIRTY_TREE on a dirty tree without --force', () => {
    initRepo(dir)
    writeFileSync(join(dir, 'dirty.txt'), 'uncommitted')
    expect(() => guardBrownfieldDirtyTree(dir, false)).toThrowError()
  })

  it('warns (does not throw) on a dirty tree WITH --force', () => {
    const warnSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    initRepo(dir)
    writeFileSync(join(dir, 'dirty.txt'), 'uncommitted')
    expect(() => guardBrownfieldDirtyTree(dir, true)).not.toThrow()
    warnSpy.mockRestore()
  })
})

// ---------------------------------------------------------------------------
describe('runGithubSetup — early-return guards', () => {
  it('skips entirely when useGitHub is false', () => {
    runGithubSetup(makeConfig(dir, { useGitHub: false }))
    expect(mockProvisionLabels).not.toHaveBeenCalled()
  })

  it('skips when githubOwner / githubRepo are null even with useGitHub', () => {
    runGithubSetup(makeConfig(dir, { useGitHub: true, githubOwner: null, githubRepo: null }))
    expect(mockProvisionLabels).not.toHaveBeenCalled()
  })

  it('provisions labels when fully configured (uses default log)', () => {
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    runGithubSetup(makeConfig(dir, { useGitHub: true, githubOwner: 'o', githubRepo: 'r' }))
    expect(mockProvisionLabels).toHaveBeenCalledWith('o', 'r')
    stdoutSpy.mockRestore()
  })
})

// ---------------------------------------------------------------------------
describe('runPlugins — plugin orchestration branches', () => {
  const storedConfig = makeConfig(dir)
  const arbiterConfig = buildArbiterConfig(storedConfig)

  beforeEach(() => {
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
  })

  it('returns empty when there are no plugins', async () => {
    const out = await runPlugins(dir, [], arbiterConfig)
    expect(out).toEqual([])
  })

  it('skips a plugin whose detect() returns false', async () => {
    mockLoadPlugin.mockResolvedValueOnce({
      templateRoot: dir,
      detect: vi.fn().mockResolvedValue(false),
      generate: vi.fn(),
    } as Awaited<ReturnType<typeof mockLoadPlugin>>)
    const out = await runPlugins(dir, ['p'], arbiterConfig)
    expect(out).toEqual([])
  })

  it('warns + continues when a plugin returns no files array', async () => {
    mockLoadPlugin.mockResolvedValueOnce({
      templateRoot: dir,
      generate: vi.fn().mockResolvedValue({ files: undefined }),
    } as unknown as Awaited<ReturnType<typeof mockLoadPlugin>>)
    const out = await runPlugins(dir, ['p'], arbiterConfig)
    expect(out).toEqual([])
  })

  it('writes a valid plugin file inside the target dir', async () => {
    mockLoadPlugin.mockResolvedValueOnce({
      templateRoot: dir,
      generate: vi.fn().mockResolvedValue({
        files: [{ path: 'plugin-out.txt', content: 'hi', action: 'write' }],
      }),
    } as unknown as Awaited<ReturnType<typeof mockLoadPlugin>>)
    const out = await runPlugins(dir, ['p'], arbiterConfig)
    expect(out).toHaveLength(1)
    expect(existsSync(join(dir, 'plugin-out.txt'))).toBe(true)
  })

  it('marks a second-plugin path collision as skipped', async () => {
    mockLoadPlugin
      .mockResolvedValueOnce({
        templateRoot: dir,
        generate: vi.fn().mockResolvedValue({
          files: [{ path: 'dup.txt', content: 'a', action: 'write' }],
        }),
      } as unknown as Awaited<ReturnType<typeof mockLoadPlugin>>)
      .mockResolvedValueOnce({
        templateRoot: dir,
        generate: vi.fn().mockResolvedValue({
          files: [{ path: 'dup.txt', content: 'b', action: 'write' }],
        }),
      } as unknown as Awaited<ReturnType<typeof mockLoadPlugin>>)
    const out = await runPlugins(dir, ['p1', 'p2'], arbiterConfig)
    expect(out.some((r) => r.action === 'skipped')).toBe(true)
  })

  it('throws aggregate error when a plugin emits a path that escapes the target dir', async () => {
    mockLoadPlugin.mockResolvedValueOnce({
      templateRoot: dir,
      generate: vi.fn().mockResolvedValue({
        files: [{ path: '../escape.txt', content: 'x', action: 'write' }],
      }),
    } as unknown as Awaited<ReturnType<typeof mockLoadPlugin>>)
    await expect(runPlugins(dir, ['p'], arbiterConfig)).rejects.toThrowError()
  })

  it('throws aggregate error when loadPlugin itself rejects', async () => {
    mockLoadPlugin.mockRejectedValueOnce(new Error('boom'))
    await expect(runPlugins(dir, ['bad'], arbiterConfig)).rejects.toThrowError()
  })
})
