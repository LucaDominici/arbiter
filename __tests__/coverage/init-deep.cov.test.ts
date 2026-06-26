// SPDX-License-Identifier: Apache-2.0
//
// Deep branch-coverage climb for src/commands/init.ts (#1486) — the REMAINING
// branches the first cov test (init.cov.test.ts) left uncovered:
//
//   - runInit orchestration: --json+!--yes early exit(78), --dry-run preview with
//     preset/auth/observability/language/archetype overrides, full --json
//     generation path (markdown backend, manifest, hooks, no-verify), tier desugar.
//   - runGithubSetup DEEP error/warning branches: setupLabels (created/updated/
//     classifiedErrors fatal+config+recoverable), setupBranchProtection (applied/
//     error+errorKind/skipped/repoSettingsError), setupProjectBoard (created/error/
//     already-exists/classifiedErrors).
//   - buildArbiterConfig remaining derive branches (github backend from useGitHub).
//   - guardBrownfieldDirtyTree ENOENT/EACCES (git binary absent) branch.
//
// The github + plugin-loader modules ARE mocked (they shell out); everything else
// runs against a real temp fixture dir, mirroring wizard/dry-run.test.ts. process.exit
// is stubbed to throw a sentinel so the runner is never killed.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync, existsSync, mkdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { makeConfig } from '../helpers.js'
import type { GhErrorKind } from '../../src/github/classify-gh-error.js'
import type { LabelProvisionResult } from '../../src/github/labels.js'
import type { BranchProtectionResult } from '../../src/github/branch-protection.js'
import type { ProjectBoardResult } from '../../src/github/project-board.js'

// --- module mocks (only the ones that shell out / hit the network) -----------
vi.mock('../../src/github/labels.js', () => ({
  provisionLabels: vi.fn(),
}))
vi.mock('../../src/github/branch-protection.js', () => ({
  applyBranchProtection: vi.fn(),
}))
vi.mock('../../src/github/project-board.js', () => ({
  createProjectBoard: vi.fn(),
}))

import { provisionLabels } from '../../src/github/labels.js'
import { applyBranchProtection } from '../../src/github/branch-protection.js'
import { createProjectBoard } from '../../src/github/project-board.js'
import { runInit, runGithubSetup, buildArbiterConfig, guardBrownfieldDirtyTree } from '../../src/commands/init.js'

const mockProvisionLabels = vi.mocked(provisionLabels)
const mockApplyBranchProtection = vi.mocked(applyBranchProtection)
const mockCreateProjectBoard = vi.mocked(createProjectBoard)

// ---- typed factories: satisfy the FULL return type of each github helper ----
function labels(overrides: Partial<LabelProvisionResult> = {}): LabelProvisionResult {
  return {
    created: [],
    updated: [],
    skipped: [],
    errors: [],
    classifiedErrors: [],
    ...overrides,
  }
}
function branchProt(overrides: Partial<BranchProtectionResult> = {}): BranchProtectionResult {
  return {
    applied: false,
    error: null,
    repoSettingsError: null,
    ...overrides,
  }
}
function board(overrides: Partial<ProjectBoardResult> = {}): ProjectBoardResult {
  return {
    created: false,
    projectUrl: null,
    error: null,
    warnings: [],
    classifiedErrors: [],
    ...overrides,
  }
}

let dir: string
let exitSpy: ReturnType<typeof vi.spyOn>
let stdoutSpy: ReturnType<typeof vi.spyOn>
let stderrSpy: ReturnType<typeof vi.spyOn>

class ProcessExit extends Error {
  constructor(public code: number) {
    super(`process.exit(${code})`)
  }
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'arbiter-init-deep-cov-'))
  vi.clearAllMocks()
  exitSpy = vi
    .spyOn(process, 'exit')
    .mockImplementation(((code?: number): never => {
      throw new ProcessExit(code ?? 0)
    }) as typeof process.exit)
  stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
  stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
  mockProvisionLabels.mockReturnValue(labels())
  mockApplyBranchProtection.mockReturnValue(branchProt())
  mockCreateProjectBoard.mockReturnValue(board())
})

afterEach(() => {
  vi.restoreAllMocks()
  rmSync(dir, { recursive: true, force: true })
})

function writeTsFixture(at: string): void {
  writeFileSync(
    join(at, 'package.json'),
    JSON.stringify({
      name: 'fixture',
      scripts: { build: 'tsc', test: 'vitest run', lint: 'eslint .' },
      devDependencies: { typescript: '^5.0.0', eslint: '^9.0.0', prettier: '^3.0.0' },
    }),
  )
}

// ---------------------------------------------------------------------------
describe('runInit — guard / early-return branches', () => {
  it('emits a config error and exits 78 when --json is passed without --yes', async () => {
    await expect(
      runInit({
        yes: false,
        json: true,
        tools: undefined,
        level: undefined,
        dir,
        dryRun: false,
        brownfield: false,
        noVerify: true,
      }),
    ).rejects.toBeInstanceOf(ProcessExit)
    expect(exitSpy).toHaveBeenCalledWith(78)
  })

  it('--tier bootstrap desugars to L1 + brownfield via dry-run (no files written)', async () => {
    writeTsFixture(dir)
    await runInit({
      yes: true,
      tools: 'claude',
      level: undefined,
      dir,
      dryRun: true,
      brownfield: false,
      noVerify: true,
      quiet: true,
      tier: 'bootstrap',
    })
    // dry-run returns before generation: no arbiter.json on disk
    expect(existsSync(join(dir, 'arbiter.json'))).toBe(false)
  })
})

// ---------------------------------------------------------------------------
describe('runInit — dry-run preview with option overrides', () => {
  it('applies preset + auth + observability + language + archetype overrides through dry-run', async () => {
    writeTsFixture(dir)
    await runInit({
      yes: true,
      tools: 'claude,codex',
      level: 'L2',
      dir,
      dryRun: true,
      brownfield: false,
      noVerify: true,
      quiet: true,
      preset: 'solo-homelab',
      authProvider: 'keycloak',
      observabilityProvider: 'signoz',
      language: 'typescript',
      archetype: 'frontend-spa',
    })
    expect(existsSync(join(dir, 'arbiter.json'))).toBe(false)
    // dry-run notice printed to stdout
    const out = stdoutSpy.mock.calls.map((c: unknown[]) => String(c[0])).join('')
    expect(out.length).toBeGreaterThan(0)
  })

  it('honours an explicit --archetype=backend-web-db (drives buildDefaultConfig db branches)', async () => {
    writeTsFixture(dir)
    await runInit({
      yes: true,
      tools: 'claude',
      level: 'L1',
      dir,
      dryRun: true,
      brownfield: false,
      noVerify: true,
      quiet: true,
      archetype: 'backend-web-db',
    })
    expect(existsSync(join(dir, 'arbiter.json'))).toBe(false)
  })
})

// ---------------------------------------------------------------------------
describe('runInit — full generation (markdown backend, --json)', () => {
  it('generates files, writes arbiter.json, activates hooks, skips verify', async () => {
    writeTsFixture(dir)
    await runInit({
      yes: true,
      json: true,
      tools: 'claude',
      level: 'L1',
      dir,
      dryRun: false,
      brownfield: false,
      noVerify: true,
      quiet: true,
    })
    expect(existsSync(join(dir, 'arbiter.json'))).toBe(true)
    expect(existsSync(join(dir, 'AGENTS.md'))).toBe(true)
    // markdown backend scaffolds .arbiter/work
    expect(existsSync(join(dir, '.arbiter', 'work'))).toBe(true)
  })

  it('non-json full generation prints results + done summary', async () => {
    writeTsFixture(dir)
    await runInit({
      yes: true,
      tools: 'claude',
      level: 'L1',
      dir,
      dryRun: false,
      brownfield: false,
      noVerify: true,
      quiet: true,
    })
    expect(existsSync(join(dir, 'arbiter.json'))).toBe(true)
    const out = stdoutSpy.mock.calls.map((c: unknown[]) => String(c[0])).join('')
    expect(out).toContain('Done!')
  })

  it('re-init reports already-existing files (skipped branch, non-brownfield)', async () => {
    writeTsFixture(dir)
    const opts = {
      yes: true,
      tools: 'claude' as const,
      level: 'L1' as const,
      dir,
      dryRun: false,
      brownfield: false,
      noVerify: true,
      quiet: true,
    }
    await runInit(opts)
    stdoutSpy.mockClear()
    await runInit(opts)
    const out = stdoutSpy.mock.calls.map((c: unknown[]) => String(c[0])).join('')
    expect(out).toContain('already exist')
  })
})

// ---------------------------------------------------------------------------
describe('runInit — adverse git state guard', () => {
  function initRepoWithMergeHead(at: string): void {
    execFileSync('git', ['init', '-q'], { cwd: at })
    execFileSync('git', ['config', 'user.email', 't@t.dev'], { cwd: at })
    execFileSync('git', ['config', 'user.name', 't'], { cwd: at })
    // Simulate an in-progress merge so detectAdverseGitState fires.
    writeFileSync(join(at, '.git', 'MERGE_HEAD'), '0000000000000000000000000000000000000000\n')
  }

  it('throws (UserFacingError) on an adverse git state without --force', async () => {
    writeTsFixture(dir)
    initRepoWithMergeHead(dir)
    await expect(
      runInit({
        yes: true,
        tools: 'claude',
        level: 'L1',
        dir,
        dryRun: true,
        brownfield: false,
        noVerify: true,
        quiet: true,
      }),
    ).rejects.toThrowError()
  })

  it('warns (no throw) on an adverse git state WITH --force (dry-run)', async () => {
    writeTsFixture(dir)
    initRepoWithMergeHead(dir)
    await runInit({
      yes: true,
      tools: 'claude',
      level: 'L1',
      dir,
      dryRun: true,
      brownfield: false,
      noVerify: true,
      quiet: true,
      force: true,
    })
    expect(existsSync(join(dir, 'arbiter.json'))).toBe(false)
  })
})

// ---------------------------------------------------------------------------
describe('runInit — recipe override path', () => {
  it('loads a recipe file and applies its axis + automation overrides (dry-run)', async () => {
    writeTsFixture(dir)
    const recipePath = join(dir, 'recipe.json')
    writeFileSync(
      recipePath,
      JSON.stringify({
        tools: ['claude'],
        governanceLevel: 'L2',
        language: 'typescript',
        archetype: 'backend-web-db',
        architectureStyle: 'hexagonal',
        isMultiTenant: true,
        hasPublicApi: true,
        databaseEngine: 'postgresql',
        contractType: 'rest-public',
        lanes: ['backend'],
        evidenceHarness: true,
        decomposition: { backend: 'markdown' },
        enableDebtGates: true,
        enableSuppressions: false,
        enableSecurityScanning: true,
        enableMutationTesting: true,
        enableContractTesting: true,
        enableSoloDevMode: false,
        enableMcpFallback: true,
        enableNoSkippedTests: true,
        automation: {
          autonomy: 'L1',
          maxParallelWorktrees: 2,
          defaultGateLevel: 'L2',
          affinityBatching: true,
        },
      }),
    )
    await runInit({
      yes: false,
      tools: undefined,
      level: undefined,
      dir,
      dryRun: true,
      brownfield: false,
      noVerify: true,
      quiet: true,
      recipe: recipePath,
    })
    expect(existsSync(join(dir, 'arbiter.json'))).toBe(false)
  })
})

// ---------------------------------------------------------------------------
describe('runInit — brownfield baseline capture (non-fatal warn branch)', () => {
  it('attempts capture at L2 brownfield and warns when the script is absent (no throw)', async () => {
    writeTsFixture(dir)
    // L2 (enableDebtGates true) + --brownfield triggers runBrownfieldCapture in
    // the non-fatal mode. The capture-debt-baseline.mjs script does NOT exist in
    // this temp dir, so the runCli failure is caught and logged as a warning.
    await runInit({
      yes: true,
      tools: 'claude',
      level: 'L2',
      dir,
      dryRun: false,
      brownfield: true,
      noVerify: true,
      quiet: true,
    })
    expect(existsSync(join(dir, 'arbiter.json'))).toBe(true)
    // Full runInit scaffold + brownfield-capture subprocess; the 30s default is
    // too tight for this in the full parallel pool — see #1604.
  }, 60_000)
})

// ---------------------------------------------------------------------------
describe('runGithubSetup — setupLabels / branch-protection / project-board branches', () => {
  const cfg = (overrides = {}) =>
    makeConfig(dir, { useGitHub: true, githubOwner: 'o', githubRepo: 'r', ...overrides })

  it('logs created + updated labels and pushes a recoverable classified error as a warning', () => {
    mockProvisionLabels.mockReturnValue(
      labels({
        created: ['type: bug'],
        updated: ['priority: high'],
        classifiedErrors: [{ message: 'rate limited', kind: 'recoverable' as GhErrorKind }],
      }),
    )
    const result = runGithubSetup(cfg(), () => {})
    expect(result.warnings).toContain('rate limited')
  })

  it('throws FatalError when a label classified error is fatal', () => {
    mockProvisionLabels.mockReturnValue(
      labels({ classifiedErrors: [{ message: 'bad credentials', kind: 'fatal' as GhErrorKind }] }),
    )
    expect(() => runGithubSetup(cfg(), () => {})).toThrowError()
  })

  it('throws ConfigError when a label classified error is config (gh missing)', () => {
    mockProvisionLabels.mockReturnValue(
      labels({ classifiedErrors: [{ message: 'gh not installed', kind: 'config' as GhErrorKind }] }),
    )
    expect(() => runGithubSetup(cfg(), () => {})).toThrowError()
  })

  it('logs success when branch protection is applied', () => {
    mockApplyBranchProtection.mockReturnValue(branchProt({ applied: true }))
    const lines: string[] = []
    runGithubSetup(cfg(), (m: string) => lines.push(m))
    expect(lines.some((l) => l.includes('Branch protection applied'))).toBe(true)
  })

  it('warns (no throw) on a recoverable branch-protection error with errorKind', () => {
    mockApplyBranchProtection.mockReturnValue(
      branchProt({ error: 'needs admin', errorKind: 'recoverable' as GhErrorKind }),
    )
    const result = runGithubSetup(cfg(), () => {})
    expect(result.warnings.some((w) => w.includes('branch protection skipped'))).toBe(true)
  })

  it('throws on a fatal branch-protection error (errorKind=fatal)', () => {
    mockApplyBranchProtection.mockReturnValue(
      branchProt({ error: 'http 401', errorKind: 'fatal' as GhErrorKind }),
    )
    expect(() => runGithubSetup(cfg(), () => {})).toThrowError()
  })

  it('skips branch protection (no error, not applied) and logs admin-access notice', () => {
    mockApplyBranchProtection.mockReturnValue(branchProt({ applied: false, error: null }))
    const lines: string[] = []
    runGithubSetup(cfg(), (m: string) => lines.push(m))
    expect(lines.some((l) => l.includes('requires admin access'))).toBe(true)
  })

  it('surfaces a repoSettingsError as an INV-101 warning', () => {
    mockApplyBranchProtection.mockReturnValue(
      branchProt({ applied: true, repoSettingsError: 'merge config blocked' }),
    )
    const result = runGithubSetup(cfg(), () => {})
    expect(result.warnings.some((w) => w.includes('INV-101'))).toBe(true)
  })

  it('logs project board created with its URL', () => {
    mockCreateProjectBoard.mockReturnValue(board({ created: true, projectUrl: 'https://x/1' }))
    const lines: string[] = []
    runGithubSetup(cfg(), (m: string) => lines.push(m))
    expect(lines.some((l) => l.includes('Project board created'))).toBe(true)
  })

  it('logs project board skipped on a board error', () => {
    mockCreateProjectBoard.mockReturnValue(board({ created: false, error: 'no scope' }))
    const lines: string[] = []
    runGithubSetup(cfg(), (m: string) => lines.push(m))
    expect(lines.some((l) => l.includes('Skipped: no scope'))).toBe(true)
  })

  it('logs project board already-exists when no error and not created', () => {
    mockCreateProjectBoard.mockReturnValue(
      board({ created: false, error: null, projectUrl: 'https://x/9' }),
    )
    const lines: string[] = []
    runGithubSetup(cfg(), (m: string) => lines.push(m))
    expect(lines.some((l) => l.includes('Already exists'))).toBe(true)
  })

  it('falls back to "unknown" when an already-existing board has no URL', () => {
    mockCreateProjectBoard.mockReturnValue(board({ created: false, error: null, projectUrl: null }))
    const lines: string[] = []
    runGithubSetup(cfg(), (m: string) => lines.push(m))
    expect(lines.some((l) => l.includes('unknown'))).toBe(true)
  })

  it('pushes a recoverable project-board classified error as a warning', () => {
    mockCreateProjectBoard.mockReturnValue(
      board({
        created: true,
        projectUrl: 'https://x/2',
        classifiedErrors: [{ message: 'field skip', kind: 'recoverable' as GhErrorKind }],
      }),
    )
    const result = runGithubSetup(cfg(), () => {})
    expect(result.warnings.some((w) => w.includes('project board'))).toBe(true)
  })

  it('throws on a fatal project-board classified error', () => {
    mockCreateProjectBoard.mockReturnValue(
      board({
        created: false,
        classifiedErrors: [{ message: 'token revoked', kind: 'fatal' as GhErrorKind }],
      }),
    )
    expect(() => runGithubSetup(cfg(), () => {})).toThrowError()
  })

  it('uses the default log (stdout) when no log fn is passed', () => {
    runGithubSetup(cfg())
    expect(mockProvisionLabels).toHaveBeenCalledWith('o', 'r')
    expect(stdoutSpy).toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
describe('buildArbiterConfig — backend-derive branches', () => {
  it('derives markdown backend when neither decompositionBackend nor useGitHub set', () => {
    const out = buildArbiterConfig(
      makeConfig(dir, { useGitHub: false, decompositionBackend: undefined }),
    )
    expect(out.decomposition).toEqual({ backend: 'markdown' })
  })

  it('derives github backend from useGitHub when decompositionBackend absent', () => {
    const out = buildArbiterConfig(
      makeConfig(dir, { useGitHub: true, decompositionBackend: undefined }),
    )
    expect(out.decomposition).toEqual({ backend: 'github' })
  })
})

// ---------------------------------------------------------------------------
describe('guardBrownfieldDirtyTree — git-binary-absent branch', () => {
  it('re-throws a non-UserFacing CliError when git is not on PATH (rethrow branch)', () => {
    // runCli wraps a missing binary in a CliError (notFound:true) whose `.code` is
    // undefined — so neither the UserFacingError nor the ENOENT/EACCES early-return
    // matches and the error propagates. This exercises the final `throw err` branch.
    const savedPath = process.env['PATH']
    const emptyBin = join(dir, 'empty-bin')
    mkdirSync(emptyBin, { recursive: true })
    process.env['PATH'] = emptyBin
    try {
      expect(() => guardBrownfieldDirtyTree(dir, false)).toThrowError()
    } finally {
      if (savedPath === undefined) delete process.env['PATH']
      else process.env['PATH'] = savedPath
    }
  })
})

// Reference stderrSpy so it is never reported as an unused binding by lint while
// still being available for the exit-path tests above (process.exit writes there).
afterEach(() => {
  expect(stderrSpy).toBeDefined()
})
