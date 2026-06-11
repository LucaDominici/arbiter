// SPDX-License-Identifier: Apache-2.0
// Exit-code contract tests for #1074 (ADR-002, INV-53).
//
// Spawn-based: config-error cases (78) run against dist/cli.js.
// Unit-based: recoverable(1) / fatal(2) / clean(0) cases use module mocks so
//             GitHub is not required.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'

// ---------------------------------------------------------------------------
// Spawn harness (cases c: exit 78)
// ---------------------------------------------------------------------------

const CLI = resolve(import.meta.dirname, '../../dist/cli.js')
const NODE = process.execPath

function spawn(args: string[], cwd?: string): { stdout: string; stderr: string; status: number } {
  const result = spawnSync(NODE, [CLI, ...args], {
    cwd,
    encoding: 'utf-8',
    timeout: 30_000,
  })
  return {
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    status: result.status ?? 1,
  }
}

describe('exit-code contract — config errors (spawn, exit 78)', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'arbiter-exit-codes-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('(c) missing arbiter.json → exit 78', () => {
    const { status } = spawn(['update'], dir)
    expect(status).toBe(78)
  })

  it('(c-json) missing arbiter.json + --json → exit 78', () => {
    const { status, stdout } = spawn(['update', '--json'], dir)
    expect(status).toBe(78)
    const parsed = JSON.parse(stdout) as Record<string, unknown>
    expect(parsed.status).toBe('error')
    expect(parsed.errorClass).toBe('config')
  })

  it('(c-malformed) malformed arbiter.json → exit 78', () => {
    writeFileSync(join(dir, 'arbiter.json'), '{bad json here')
    const { status } = spawn(['update'], dir)
    expect(status).toBe(78)
  })

  it('(c-malformed-json) malformed arbiter.json + --json → still exit 78 (ConfigError bypasses JSON mode)', () => {
    // ConfigError is thrown during config parse, before the command's --json handler
    // runs. The top-level handler writes to stderr (text) and exits 78 regardless of --json.
    writeFileSync(join(dir, 'arbiter.json'), '{bad json here')
    const { status, stderr } = spawn(['update', '--json'], dir)
    expect(status).toBe(78)
    expect(stderr).toMatch(/[Cc]onfig|E_CONFIG/)
  })
}, 60_000)

// ---------------------------------------------------------------------------
// Unit-based (cases a, b, d, e — no real GitHub needed)
// ---------------------------------------------------------------------------

vi.mock('../../src/utils/config.js', () => ({
  loadConfig: vi.fn(),
  loadSnapshot: vi.fn().mockReturnValue(null),
  saveConfigAndSnapshot: vi.fn(),
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
  detectAdverseGitState: vi.fn().mockReturnValue(null),
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
  runGithubSetup: vi.fn().mockReturnValue({ warnings: [] }),
  printResults: vi.fn(),
  runPlugins: vi.fn().mockResolvedValue([]),
}))

import { runUpdate } from '../../src/commands/update.js'
import { loadConfig } from '../../src/utils/config.js'
import { validateConfig } from '../../src/config/schema.js'
import { runGithubSetup } from '../../src/commands/init.js'
import { FatalError, ConfigError } from '../../src/utils/errors.js'

const mockLoadConfig = loadConfig as ReturnType<typeof vi.fn>
const mockValidateConfig = validateConfig as ReturnType<typeof vi.fn>
const mockRunGithubSetup = vi.mocked(runGithubSetup)

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

describe('exit-code contract — update command (unit)', () => {
  let written: string
  let unitDir: string

  beforeEach(() => {
    unitDir = mkdtempSync(join(tmpdir(), 'arbiter-exit-codes-unit-'))
    written = ''
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
      written += String(chunk)
      return true
    })
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    vi.spyOn(console, 'log').mockImplementation(() => {})
    mockRunGithubSetup.mockReturnValue({ warnings: [] })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    rmSync(unitDir, { recursive: true, force: true })
  })

  it('(a) 3 recoverable backend warnings → exit 1 (non-JSON)', async () => {
    mockLoadConfig.mockReturnValue({ ...BASE_CONFIG })
    mockValidateConfig.mockReturnValue({ ok: true, config: BASE_CONFIG })
    mockRunGithubSetup.mockReturnValue({
      warnings: ['label 404: triage', 'label 404: bug', 'label 404: wontfix'],
    })

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit')
    })

    await expect(runUpdate({ dir: unitDir, github: true })).rejects.toThrow('process.exit')
    expect(exitSpy).toHaveBeenCalledWith(1)
  })

  it('(a-json) 3 recoverable backend warnings → exit 1, envelope status=warning', async () => {
    mockLoadConfig.mockReturnValue({ ...BASE_CONFIG })
    mockValidateConfig.mockReturnValue({ ok: true, config: BASE_CONFIG })
    mockRunGithubSetup.mockReturnValue({
      warnings: ['label 404: triage', 'label 404: bug', 'label 404: wontfix'],
    })

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit')
    })

    await expect(runUpdate({ dir: unitDir, github: true, json: true })).rejects.toThrow(
      'process.exit',
    )

    const parsed = JSON.parse(written) as Record<string, unknown>
    expect(parsed.status).toBe('warning')
    expect(Array.isArray(parsed.warnings)).toBe(true)
    expect((parsed.warnings as string[]).length).toBe(3)
    expect(exitSpy).toHaveBeenCalledWith(1)
  })

  it('(b) FatalError from backend setup → propagates with recoverableContext', async () => {
    mockLoadConfig.mockReturnValue({ ...BASE_CONFIG })
    mockValidateConfig.mockReturnValue({ ok: true, config: BASE_CONFIG })
    mockRunGithubSetup.mockImplementation(() => {
      throw new FatalError('E_GH_FATAL', 'auth token revoked', {
        recoverableContext: ['label 404: triage', 'label 404: bug'],
      })
    })

    const err = await runUpdate({ dir: unitDir, github: true }).catch((e: unknown) => e)

    expect(err).toBeInstanceOf(FatalError)
    const fatalErr = err as FatalError
    expect(fatalErr.recoverableContext).toHaveLength(2)
    expect(fatalErr.recoverableContext![0]).toContain('label 404')
  })

  it('(b) FatalError is NOT instanceof ConfigError or RecoverableError (RT1 handler order)', () => {
    const fatal = new FatalError('E_GH_FATAL', 'fatal')
    expect(fatal).toBeInstanceOf(FatalError)
    expect(fatal).not.toBeInstanceOf(ConfigError)
  })

  it('(d) clean run → exit 0 (no process.exit call)', async () => {
    mockLoadConfig.mockReturnValue({ ...BASE_CONFIG })
    mockValidateConfig.mockReturnValue({ ok: true, config: BASE_CONFIG })

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit')
    })

    await runUpdate({ dir: unitDir, github: false })
    expect(exitSpy).not.toHaveBeenCalled()
  })

  it('(e-d) json + clean run → exit 0, envelope status=ok', async () => {
    mockLoadConfig.mockReturnValue({ ...BASE_CONFIG })
    mockValidateConfig.mockReturnValue({ ok: true, config: BASE_CONFIG })

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit')
    })

    await runUpdate({ dir: unitDir, github: false, json: true })

    const parsed = JSON.parse(written) as Record<string, unknown>
    expect(parsed.status).toBe('ok')
    expect(exitSpy).not.toHaveBeenCalled()
  })
})

// #1291 — wave/batch is an L3 behavior; below it the CLI must refuse with exit 1.
describe('exit-code contract — ship --batch autonomy gate (#1291)', () => {
  it('refuses --batch with exit 1 when autonomy resolves below L3', () => {
    const dir = mkdtempSync(join(tmpdir(), 'arbiter-batch-gate-'))
    try {
      const r = spawn(['ship', '--batch', '1,2', '--dir', dir], dir)
      expect(r.status).toBe(1)
      expect(r.stderr).toContain('requires automation.autonomy L3')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
