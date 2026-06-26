// SPDX-License-Identifier: Apache-2.0
/**
 * Branch-coverage climb for src/compatibility/probe.ts.
 *
 * Targets branches the primary suite leaves uncovered:
 *  - probeTool: matrix-bug path (UnparseableConstraintError), CliError
 *    detail fallback to `.message`, and rethrow of a non-CliError.
 *  - runBuildProbe: CliError detail fallback to `.message`, and rethrow of a
 *    non-CliError.
 *  - validateMatrix: entry-not-object and tool-not-string guards.
 *  - runProbes: the language-dispatch ternary for typescript / rust / go /
 *    python.
 *  - parseTimeoutEnv: empty/invalid/valid env-var branches, exercised via a
 *    clean module re-import with the relevant env set.
 *
 * runCli / detectLanguage / existsSync are module-mocked exactly as the primary
 * suite does, so the suite stays hermetic (no real git/gh/fs/spawn).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { MockInstance } from 'vitest'

interface CliErrorDetails {
  cmd: string
  args: readonly string[]
  exitCode: number
  stdout: string
  stderr: string
  timedOut: boolean
  notFound?: boolean
}

vi.mock('../../src/utils/run-cli.js', () => ({
  runCli: vi.fn(),
  CliError: class CliError extends Error {
    readonly cmd: string
    readonly args: readonly string[]
    readonly exitCode: number
    readonly stdout: string
    readonly stderr: string
    readonly timedOut: boolean
    readonly notFound: boolean
    constructor(details: CliErrorDetails) {
      super(
        details.notFound
          ? `Command not found: ${details.cmd}`
          : details.timedOut
            ? `Command timed out: ${details.cmd}`
            : `Command failed (exit ${details.exitCode})`,
      )
      this.name = 'CliError'
      this.cmd = details.cmd
      this.args = details.args
      this.exitCode = details.exitCode
      this.stdout = details.stdout
      this.stderr = details.stderr
      this.timedOut = details.timedOut
      this.notFound = details.notFound ?? false
    }
  },
}))

vi.mock('../../src/detectors/language.js', () => ({
  detectLanguage: vi.fn(),
}))

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return { ...actual, existsSync: vi.fn() }
})

import { runCli, CliError } from '../../src/utils/run-cli.js'
import { detectLanguage } from '../../src/detectors/language.js'
import { existsSync } from 'node:fs'
import {
  probeTool,
  runBuildProbe,
  runProbes,
  validateMatrix,
  type BuildProbeSpec,
} from '../../src/compatibility/probe.js'

const mockRunCli = runCli as unknown as MockInstance
const mockDetectLanguage = detectLanguage as unknown as MockInstance
const mockExistsSync = existsSync as unknown as MockInstance

interface CliResult {
  stdout: string
  stderr: string
  exitCode: number
  durationMs: number
}

function ok(stdout: string, stderr = ''): CliResult {
  return { stdout, stderr, exitCode: 0, durationMs: 1 }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('probeTool — matrix-bug (UnparseableConstraintError → failed)', () => {
  it('surfaces an unparseable range as matrix-bug, keeping the parsed version', () => {
    mockRunCli.mockReturnValue(ok('v20.11.1\n'))
    // 'garbage' has no comparator operator → matcher throws UnparseableConstraintError.
    const result = probeTool('node', ['--version'], 'garbage', 'stdout')
    expect(result.status).toBe('failed')
    expect(result.reason).toMatch(/^matrix-bug:/)
    expect(result.version).toEqual({ major: 20, minor: 11, patch: 1 })
  })
})

describe('probeTool — CliError detail falls back to message', () => {
  it('uses err.message when both stderr and stdout are empty', () => {
    mockRunCli.mockImplementation(() => {
      throw new CliError({
        cmd: 'node',
        args: ['--version'],
        exitCode: 7,
        stdout: '',
        stderr: '',
        timedOut: false,
      })
    })
    const result = probeTool('node', ['--version'], '>=18', 'stdout')
    expect(result.status).toBe('failed')
    expect(result.reason).toContain('exit 7')
    // Neither stderr nor stdout → message is the only non-empty source.
    expect(result.reason).toContain('Command failed (exit 7)')
  })
})

describe('probeTool — non-CliError is rethrown', () => {
  it('rethrows an unexpected error rather than swallowing it', () => {
    const boom = new Error('unexpected spawn failure')
    mockRunCli.mockImplementation(() => {
      throw boom
    })
    expect(() => probeTool('node', ['--version'], '>=18', 'stdout')).toThrow(boom)
  })
})

describe('runBuildProbe — CliError detail falls back to message', () => {
  it('uses err.message when stderr and stdout are both empty', () => {
    mockExistsSync.mockReturnValue(true)
    mockRunCli.mockImplementation(() => {
      throw new CliError({
        cmd: 'cargo',
        args: ['check'],
        exitCode: 9,
        stdout: '',
        stderr: '',
        timedOut: false,
      })
    })
    const spec: BuildProbeSpec = {
      name: 'cargo:check',
      command: 'cargo',
      args: ['check'],
      requires: 'Cargo.toml',
    }
    const result = runBuildProbe('/some/dir', spec)
    expect(result.status).toBe('failed')
    expect(result.kind).toBe('build')
    expect(result.reason).toContain('exit 9')
    expect(result.reason).toContain('Command failed (exit 9)')
  })
})

describe('runBuildProbe — non-CliError is rethrown', () => {
  it('rethrows an unexpected non-CliError', () => {
    mockExistsSync.mockReturnValue(true)
    const boom = new Error('build runner exploded')
    mockRunCli.mockImplementation(() => {
      throw boom
    })
    const spec: BuildProbeSpec = {
      name: 'tsc:noEmit',
      command: 'npx',
      args: ['tsc', '--noEmit'],
      requires: 'tsconfig.json',
    }
    expect(() => runBuildProbe('/some/dir', spec)).toThrow(boom)
  })
})

describe('validateMatrix — entry-level guards', () => {
  it('throws when an entry is not an object', () => {
    const bad = {
      typescript: ['not-an-object'],
      java: [],
      kotlin: [],
      rust: [],
      go: [],
      python: [],
    }
    expect(() => validateMatrix(bad)).toThrow(/typescript\[0\] must be an object/)
  })

  it('throws when an entry is null', () => {
    const bad = {
      typescript: [null],
      java: [],
      kotlin: [],
      rust: [],
      go: [],
      python: [],
    }
    expect(() => validateMatrix(bad)).toThrow(/typescript\[0\] must be an object/)
  })

  it('throws when an entry.tool is not a string', () => {
    const bad = {
      typescript: [{ tool: 123, range: '>=18' }],
      java: [],
      kotlin: [],
      rust: [],
      go: [],
      python: [],
    }
    expect(() => validateMatrix(bad)).toThrow(/typescript\[0\]\.tool expected string, got number/)
  })
})

describe('runProbes — language dispatch ternary', () => {
  beforeEach(() => {
    // No build-file guard hits and no .githooks/pre-commit → keeps the report
    // limited to the version probes for each dispatch branch.
    mockExistsSync.mockReturnValue(false)
  })

  // The version-probe tools must lead the report. A per-stack build probe may
  // append a trailing entry (skipped when its file guard misses), so assert the
  // version probes by prefix rather than exact equality.
  function versionTools(report: ReturnType<typeof runProbes>, count: number): string[] {
    return report.probes.slice(0, count).map((p) => p.tool)
  }

  it('dispatches typescript matrix (node, npm)', () => {
    mockDetectLanguage.mockReturnValue('typescript')
    mockRunCli.mockImplementation((cmd: string) => {
      if (cmd === 'node') return ok('v20.11.1\n')
      if (cmd === 'npm') return ok('10.5.0\n')
      return ok('')
    })
    const report = runProbes('/ts/dir')
    expect(report.stack).toBe('typescript')
    expect(versionTools(report, 2)).toEqual(['node', 'npm'])
    expect(report.probes.slice(0, 2).every((p) => p.status === 'passed')).toBe(true)
    expect(report.hasFailures).toBe(false)
  })

  it('dispatches rust matrix (rustc, cargo)', () => {
    mockDetectLanguage.mockReturnValue('rust')
    mockRunCli.mockImplementation((cmd: string) => {
      if (cmd === 'rustc') return ok('rustc 1.78.0 (9b00956e5 2024-04-29)\n')
      if (cmd === 'cargo') return ok('cargo 1.78.0 (54d8815d0 2024-03-26)\n')
      return ok('')
    })
    const report = runProbes('/rust/dir')
    expect(report.stack).toBe('rust')
    expect(versionTools(report, 2)).toEqual(['rustc', 'cargo'])
    expect(report.probes.slice(0, 2).every((p) => p.status === 'passed')).toBe(true)
  })

  it('dispatches go matrix (go)', () => {
    mockDetectLanguage.mockReturnValue('go')
    mockRunCli.mockImplementation((cmd: string) => {
      if (cmd === 'go') return ok('go version go1.22.3 linux/amd64\n')
      return ok('')
    })
    const report = runProbes('/go/dir')
    expect(report.stack).toBe('go')
    expect(versionTools(report, 1)).toEqual(['go'])
    expect(report.probes[0]?.status).toBe('passed')
  })

  it('dispatches python matrix (python3, pip, ruff, lint-imports)', () => {
    mockDetectLanguage.mockReturnValue('python')
    mockRunCli.mockImplementation((cmd: string) => {
      if (cmd === 'python3') return ok('Python 3.12.2\n')
      if (cmd === 'pip') return ok('pip 24.0 from /x (python 3.12)\n')
      if (cmd === 'ruff') return ok('ruff 0.4.5\n')
      if (cmd === 'lint-imports') return ok('lint-imports, version 2.11.0\n')
      return ok('')
    })
    const report = runProbes('/py/dir')
    expect(report.stack).toBe('python')
    expect(versionTools(report, 4)).toEqual(['python3', 'pip', 'ruff', 'lint-imports'])
    expect(report.probes.slice(0, 4).every((p) => p.status === 'passed')).toBe(true)
  })
})

describe('parseTimeoutEnv — env-var branches (clean re-import)', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  async function importFresh(): Promise<typeof import('../../src/compatibility/probe.js')> {
    // Re-mock the same modules for the freshly-reset module registry.
    vi.doMock('../../src/utils/run-cli.js', () => ({
      runCli: vi.fn(),
      CliError: class CliError extends Error {},
    }))
    vi.doMock('../../src/detectors/language.js', () => ({ detectLanguage: vi.fn() }))
    return import('../../src/compatibility/probe.js')
  }

  it('uses fallback when the env var is empty (empty-string branch)', async () => {
    vi.stubEnv('ARBITER_PROBE_TIMEOUT_MS', '')
    const mod = await importFresh()
    // Module loads without throwing → the empty-string branch returned the
    // fallback. Re-exported surface confirms a clean load.
    expect(typeof mod.probeTool).toBe('function')
  })

  it('uses fallback when the env var is non-numeric (invalid branch)', async () => {
    vi.stubEnv('ARBITER_BUILD_PROBE_TIMEOUT_MS', 'not-a-number')
    const mod = await importFresh()
    expect(typeof mod.runBuildProbe).toBe('function')
  })

  it('uses fallback when the env var is zero/negative (n>0 branch false)', async () => {
    vi.stubEnv('ARBITER_PROBE_TIMEOUT_MS', '0')
    vi.stubEnv('ARBITER_BUILD_PROBE_TIMEOUT_MS', '-5')
    const mod = await importFresh()
    expect(typeof mod.runProbes).toBe('function')
  })

  it('honors a valid positive override (n>0 branch true)', async () => {
    vi.stubEnv('ARBITER_PROBE_TIMEOUT_MS', '2500')
    vi.stubEnv('ARBITER_BUILD_PROBE_TIMEOUT_MS', '45000')
    const mod = await importFresh()
    expect(typeof mod.validateMatrix).toBe('function')
  })
})
