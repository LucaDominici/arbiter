import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { MockInstance } from 'vitest'

// Mock runCli before importing probe (module-level mock)
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
    constructor(details: {
      cmd: string
      args: readonly string[]
      exitCode: number
      stdout: string
      stderr: string
      timedOut: boolean
      notFound?: boolean
    }) {
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

import { runCli, CliError } from '../../src/utils/run-cli.js'
import {
  probeTool,
  runBuildProbe,
  runProbes,
  validateMatrix,
  probeHooksPath,
} from '../../src/compatibility/probe.js'
import { detectLanguage } from '../../src/detectors/language.js'

const mockRunCli = runCli as MockInstance
const mockDetectLanguage = detectLanguage as unknown as MockInstance

beforeEach(() => {
  vi.clearAllMocks()
})

describe('probeTool — happy path (passed)', () => {
  it('returns passed with parsed version when tool is found and in range', () => {
    mockRunCli.mockReturnValue({
      stdout: 'v20.11.1\n',
      stderr: '',
      exitCode: 0,
      durationMs: 5,
    })
    const result = probeTool('node', ['--version'], '>=18', 'stdout')
    expect(result.status).toBe('passed')
    expect(result.version).toEqual({ major: 20, minor: 11, patch: 1 })
    expect(result.reason).toBeUndefined()
  })
})

describe('probeTool — notFound → skipped', () => {
  it('returns skipped:toolchain-missing when tool is not installed', () => {
    mockRunCli.mockImplementation(() => {
      throw new CliError({
        cmd: 'go',
        args: ['version'],
        exitCode: -1,
        stdout: '',
        stderr: '',
        timedOut: false,
        notFound: true,
      })
    })
    const result = probeTool('go', ['version'], '>=1.21', 'stdout')
    expect(result.status).toBe('skipped')
    expect(result.reason).toBe('toolchain-missing')
    expect(result.version).toBeUndefined()
  })
})

describe('probeTool — timedOut → failed', () => {
  it('returns failed with probe timeout reason', () => {
    mockRunCli.mockImplementation(() => {
      throw new CliError({
        cmd: 'node',
        args: ['--version'],
        exitCode: -1,
        stdout: '',
        stderr: '',
        timedOut: true,
      })
    })
    const result = probeTool('node', ['--version'], '>=18', 'stdout')
    expect(result.status).toBe('failed')
    expect(result.reason).toMatch(/probe timeout/)
  })
})

describe('probeTool — non-zero exit → failed', () => {
  it('returns failed with exit code and stderr excerpt', () => {
    mockRunCli.mockImplementation(() => {
      throw new CliError({
        cmd: 'node',
        args: ['--version'],
        exitCode: 1,
        stdout: '',
        stderr: 'some broken install',
        timedOut: false,
      })
    })
    const result = probeTool('node', ['--version'], '>=18', 'stdout')
    expect(result.status).toBe('failed')
    expect(result.reason).toContain('exit 1')
    expect(result.reason).toContain('some broken install')
  })
})

describe('probeTool — no spec → failed', () => {
  it('returns failed when TOOL_SPECS lookup misses', () => {
    const result = probeTool('unknown-tool-xyz', ['--version'], '>=1', 'stdout')
    expect(result.status).toBe('failed')
    expect(result.reason).toBe('no spec for tool: unknown-tool-xyz')
    expect(mockRunCli).not.toHaveBeenCalled()
  })
})

describe('probeTool — version outside range → failed', () => {
  it('returns failed when installed version is too old', () => {
    mockRunCli.mockReturnValue({
      stdout: 'v16.20.0\n',
      stderr: '',
      exitCode: 0,
      durationMs: 3,
    })
    const result = probeTool('node', ['--version'], '>=18', 'stdout')
    expect(result.status).toBe('failed')
    expect(result.version).toEqual({ major: 16, minor: 20, patch: 0 })
    expect(result.reason).toMatch(/outside/)
  })
})

describe('probeTool — stderr output (java)', () => {
  it('parses version from stderr when channel is stderr', () => {
    mockRunCli.mockReturnValue({
      stdout: '',
      stderr: 'openjdk version "21.0.1" 2023-10-17\n',
      exitCode: 0,
      durationMs: 10,
    })
    const result = probeTool('java', ['-version'], '>=17', 'stderr')
    expect(result.status).toBe('passed')
    expect(result.version).toEqual({ major: 21, minor: 0, patch: 1 })
  })
})

describe('probeTool — unparseable output → failed', () => {
  it('returns failed when output cannot be parsed', () => {
    mockRunCli.mockReturnValue({
      stdout: 'unexpected output\n',
      stderr: '',
      exitCode: 0,
      durationMs: 2,
    })
    const result = probeTool('node', ['--version'], '>=18', 'stdout')
    expect(result.status).toBe('failed')
    expect(result.reason).toMatch(/unrecognized/)
  })
})

// --- build probes ---

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return { ...actual, existsSync: vi.fn() }
})

import { existsSync } from 'node:fs'
const mockExistsSync = existsSync as MockInstance

describe('runBuildProbe — requires file missing → skipped', () => {
  it('returns skipped with path in reason when required file does not exist', () => {
    mockExistsSync.mockReturnValue(false)
    const result = runBuildProbe('/some/dir', {
      name: 'gradlew:help',
      command: './gradlew',
      args: ['help', '--offline'],
      requires: 'gradlew',
    })
    expect(result.status).toBe('skipped')
    expect(result.reason).toBe('build-file-not-found: gradlew')
    expect(result.kind).toBe('build')
    expect(mockRunCli).not.toHaveBeenCalled()
  })
})

describe('runBuildProbe — command succeeds → passed', () => {
  it('returns passed when command exits 0', () => {
    mockExistsSync.mockReturnValue(true)
    mockRunCli.mockReturnValue({
      stdout: '',
      stderr: '',
      exitCode: 0,
      durationMs: 100,
    })
    const result = runBuildProbe('/some/dir', {
      name: 'gradlew:help',
      command: './gradlew',
      args: ['help', '--offline'],
      requires: 'gradlew',
    })
    expect(result.status).toBe('passed')
    expect(result.kind).toBe('build')
    expect(mockRunCli).toHaveBeenCalledWith(
      './gradlew',
      ['help', '--offline'],
      expect.objectContaining({ cwd: '/some/dir' }),
    )
  })
})

describe('runBuildProbe — CliError → failed', () => {
  it('returns failed with stderr excerpt when command fails', () => {
    mockExistsSync.mockReturnValue(true)
    mockRunCli.mockImplementation(() => {
      throw new CliError({
        cmd: './gradlew',
        args: ['help', '--offline'],
        exitCode: 1,
        stdout: '',
        stderr: 'FAILURE: Build failed with an exception.',
        timedOut: false,
      })
    })
    const result = runBuildProbe('/some/dir', {
      name: 'gradlew:help',
      command: './gradlew',
      args: ['help', '--offline'],
      requires: 'gradlew',
    })
    expect(result.status).toBe('failed')
    expect(result.kind).toBe('build')
    expect(result.reason).toContain('FAILURE')
  })
})

describe("runBuildProbe — notFound → failed with 'build tool missing'", () => {
  it('returns failed with build-tool-missing reason when command not installed', () => {
    mockExistsSync.mockReturnValue(true)
    mockRunCli.mockImplementation(() => {
      throw new CliError({
        cmd: 'cargo',
        args: ['check'],
        exitCode: -1,
        stdout: '',
        stderr: '',
        timedOut: false,
        notFound: true,
      })
    })
    const result = runBuildProbe('/some/dir', {
      name: 'cargo:check',
      command: 'cargo',
      args: ['check'],
      requires: 'Cargo.toml',
    })
    expect(result.status).toBe('failed')
    expect(result.kind).toBe('build')
    expect(result.reason).toBe('build tool missing: cargo')
  })
})

describe('runBuildProbe — timedOut → failed with timeout reason', () => {
  it('returns failed with build-timeout reason when command hangs', () => {
    mockExistsSync.mockReturnValue(true)
    mockRunCli.mockImplementation(() => {
      throw new CliError({
        cmd: './gradlew',
        args: ['--version'],
        exitCode: -1,
        stdout: '',
        stderr: '',
        timedOut: true,
      })
    })
    const result = runBuildProbe('/some/dir', {
      name: 'gradlew:version',
      command: './gradlew',
      args: ['--version'],
      requires: 'gradlew',
    })
    expect(result.status).toBe('failed')
    expect(result.reason).toMatch(/build timeout/)
  })
})

describe('runBuildProbe — stderr empty uses stdout fallback', () => {
  it('surfaces stdout in reason when stderr is empty', () => {
    mockExistsSync.mockReturnValue(true)
    mockRunCli.mockImplementation(() => {
      throw new CliError({
        cmd: 'go',
        args: ['build', '-n', './...'],
        exitCode: 2,
        stdout: 'package main: no Go files',
        stderr: '',
        timedOut: false,
      })
    })
    const result = runBuildProbe('/some/dir', {
      name: 'go:build',
      command: 'go',
      args: ['build', '-n', './...'],
      requires: 'go.mod',
    })
    expect(result.status).toBe('failed')
    expect(result.reason).toContain('exit 2')
    expect(result.reason).toContain('no Go files')
  })
})

describe('runBuildProbe — empty requires → always run', () => {
  it('runs command even when requires is empty string', () => {
    mockExistsSync.mockReturnValue(false) // should not be called for empty requires
    mockRunCli.mockReturnValue({
      stdout: 'ruff 0.4.5\n',
      stderr: '',
      exitCode: 0,
      durationMs: 5,
    })
    const result = runBuildProbe('/some/dir', {
      name: 'ruff:version',
      command: 'ruff',
      args: ['--version'],
      requires: '',
    })
    expect(result.status).toBe('passed')
    expect(result.kind).toBe('build')
  })
})

describe('runProbes — kotlin dispatch', () => {
  it('runs java + kotlinc + gradle version probes when detectLanguage returns kotlin', () => {
    mockDetectLanguage.mockReturnValue('kotlin')
    mockExistsSync.mockReturnValue(false) // no build-probe spec for kotlin anyway
    mockRunCli
      .mockReturnValueOnce({
        stdout: '',
        stderr: 'openjdk version "21.0.1" 2023-10-17\n',
        exitCode: 0,
        durationMs: 10,
      })
      .mockReturnValueOnce({
        stdout: '',
        stderr: 'kotlinc-jvm 1.9.23 (JRE 21.0.1+12)\n',
        exitCode: 0,
        durationMs: 15,
      })
      .mockReturnValueOnce({
        stdout: 'Gradle 8.5\n',
        stderr: '',
        exitCode: 0,
        durationMs: 20,
      })

    const report = runProbes('/some/kotlin/dir')
    expect(report.stack).toBe('kotlin')
    expect(report.probes).toHaveLength(3)
    expect(report.probes.map((p) => p.tool)).toEqual(['java', 'kotlinc', 'gradle'])
    expect(report.probes.every((p) => p.status === 'passed')).toBe(true)
    expect(report.hasFailures).toBe(false)
  })
})

describe('probeHooksPath', () => {
  it('returns null when .githooks/pre-commit does not exist', () => {
    mockExistsSync.mockReturnValue(false)
    const result = probeHooksPath('/some/dir')
    expect(result).toBeNull()
  })

  it('returns warning when pre-commit exists but core.hooksPath is not set', () => {
    mockExistsSync.mockReturnValue(true)
    mockRunCli.mockImplementation(() => {
      throw new CliError({
        cmd: 'git',
        args: ['config', '--get', 'core.hooksPath'],
        exitCode: 1,
        stdout: '',
        stderr: '',
        timedOut: false,
      })
    })
    const result = probeHooksPath('/some/dir')
    expect(result).not.toBeNull()
    expect(result?.status).toBe('warning')
    expect(result?.tool).toBe('hooksPath')
    expect(result?.reason).toMatch(/core\.hooksPath/)
    expect(result?.kind).toBeUndefined()
  })

  it('returns passed when pre-commit exists and core.hooksPath is .githooks', () => {
    mockExistsSync.mockReturnValue(true)
    mockRunCli.mockReturnValue({
      stdout: '.githooks\n',
      stderr: '',
      exitCode: 0,
      durationMs: 5,
    })
    const result = probeHooksPath('/some/dir')
    expect(result).not.toBeNull()
    expect(result?.status).toBe('passed')
    expect(result?.tool).toBe('hooksPath')
    expect(result?.kind).toBeUndefined()
  })
})

describe('runProbes — hasWarnings aggregation', () => {
  it('sets hasWarnings=true when probeHooksPath returns a warning', () => {
    mockDetectLanguage.mockReturnValue('kotlin')
    // kotlin probes: 3x runCli (java, kotlinc, gradle), no build probe
    mockRunCli
      .mockReturnValueOnce({
        stdout: '',
        stderr: 'openjdk version "21.0.1" 2023-10-17\n',
        exitCode: 0,
        durationMs: 10,
      })
      .mockReturnValueOnce({
        stdout: '',
        stderr: 'kotlinc-jvm 1.9.23 (JRE 21.0.1+12)\n',
        exitCode: 0,
        durationMs: 15,
      })
      .mockReturnValueOnce({
        stdout: 'Gradle 8.5\n',
        stderr: '',
        exitCode: 0,
        durationMs: 20,
      })
      .mockImplementationOnce(() => {
        throw new CliError({
          cmd: 'git',
          args: ['config', '--get', 'core.hooksPath'],
          exitCode: 1,
          stdout: '',
          stderr: '',
          timedOut: false,
        })
      })
    // probeHooksPath: existsSync(.githooks/pre-commit) → true
    mockExistsSync.mockReturnValueOnce(true)

    const report = runProbes('/some/kotlin/dir')
    expect(report.hasWarnings).toBe(true)
    expect(report.hasFailures).toBe(false)
    const hp = report.probes.find((p) => p.tool === 'hooksPath')
    expect(hp?.status).toBe('warning')
  })
})

describe('validateMatrix', () => {
  it('accepts a valid matrix object', () => {
    const valid = {
      typescript: [{ tool: 'node', range: '>=18' }],
      java: [{ tool: 'java', range: '>=17' }],
      kotlin: [{ tool: 'kotlinc', range: '>=1.9' }],
      rust: [{ tool: 'rustc', range: '>=1.70' }],
      go: [{ tool: 'go', range: '>=1.21' }],
      python: [{ tool: 'python3', range: '>=3.10' }],
    }
    expect(() => validateMatrix(valid)).not.toThrow()
  })

  it('throws when root is not an object', () => {
    expect(() => validateMatrix([])).toThrow(/root must be an object/)
  })

  it('throws with offending key when a language key is missing', () => {
    const bad = {
      typescript: [],
      java: [],
      rust: [],
      go: [],
      python: [],
      // kotlin missing
    }
    expect(() => validateMatrix(bad)).toThrow(/kotlin must be an array/)
  })

  it('throws with indexed path when an entry range is wrong type', () => {
    const bad = {
      typescript: [],
      java: [],
      kotlin: [
        { tool: 'java', range: '>=17' },
        { tool: 'kotlinc', range: 1.9 }, // number, not string
      ],
      rust: [],
      go: [],
      python: [],
    }
    expect(() => validateMatrix(bad)).toThrow(/kotlin\[1\]\.range expected string/)
  })
})
