import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { MockInstance } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

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

describe('probeTool — --version unsupported → skipped (#1597)', () => {
  it('returns skipped when the tool errors that --version is not a known option', () => {
    // import-linter only added `--version` in 2.11; installs in [2.0, 2.10]
    // (which satisfy the matrix floor) error with Click "No such option:
    // --version". That means the version is unprobeable, not invalid — skip,
    // do not hard-fail verification (#1597 gap 3).
    mockRunCli.mockImplementation(() => {
      throw new CliError({
        cmd: 'lint-imports',
        args: ['--version'],
        exitCode: 2,
        stdout: '',
        stderr: 'Error: No such option: --version',
        timedOut: false,
      })
    })
    const result = probeTool('lint-imports', ['--version'], '>=2.11', 'stdout')
    expect(result.status).toBe('skipped')
    expect(result.reason).toMatch(/--version/)
  })

  it('returns skipped for an argparse "unrecognized arguments: --version" error', () => {
    mockRunCli.mockImplementation(() => {
      throw new CliError({
        cmd: 'sometool',
        args: ['--version'],
        exitCode: 2,
        stdout: '',
        stderr: 'usage: sometool ...\nsometool: error: unrecognized arguments: --version',
        timedOut: false,
      })
    })
    const result = probeTool('lint-imports', ['--version'], '>=2.11', 'stdout')
    expect(result.status).toBe('skipped')
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

describe('runBuildProbe — npx command without node_modules → skipped, not failed', () => {
  it('skips tsc:noEmit-shaped probe with a corrected hint when node_modules is missing (virgin `arbiter init -y`)', () => {
    // Repro: a fresh `arbiter init -y` scaffolds tsconfig.json (requires: passes)
    // BEFORE `npm install` ever runs. Without this guard, `npx tsc --noEmit` either
    // fails to bootstrap tsc or reports "cannot find module 'vitest'" for the
    // just-generated test file — a false "TypeScript errors" failure with nothing
    // to do with the user's code, previously surfaced as `status: 'failed'` with
    // the misleading generic hint "Fix TypeScript errors or install: npm install
    // --save-dev typescript" (typescript is already a declared devDependency; the
    // real fix is just running the install). This must never reach runCli/npx at all.
    mockExistsSync.mockImplementation((p: unknown) => !String(p).endsWith('node_modules'))
    const result = runBuildProbe('/some/dir', {
      name: 'tsc:noEmit',
      command: 'npx',
      args: ['tsc', '--noEmit'],
      requires: 'tsconfig.json',
    })
    expect(result.status).toBe('skipped')
    expect(result.kind).toBe('build')
    expect(result.reason).toBe(
      'node-modules-missing: run `npm install`, then `arbiter validate` to verify',
    )
    expect(mockRunCli).not.toHaveBeenCalled()
  })

  it('still runs when node_modules IS present (normal case)', () => {
    mockExistsSync.mockReturnValue(true)
    mockRunCli.mockReturnValue({ stdout: '', stderr: '', exitCode: 0, durationMs: 50 })
    const result = runBuildProbe('/some/dir', {
      name: 'tsc:noEmit',
      command: 'npx',
      args: ['tsc', '--noEmit'],
      requires: 'tsconfig.json',
    })
    expect(result.status).toBe('passed')
    expect(mockRunCli).toHaveBeenCalledWith(
      'npx',
      ['tsc', '--noEmit'],
      expect.objectContaining({ cwd: '/some/dir' }),
    )
  })

  it('does not apply the node_modules guard to non-npx build probes (e.g. gradlew)', () => {
    // Only npx-invoked probes route through npm's dependency tree; gradlew/cargo/go
    // shell out to their own toolchain binaries directly and must not be skipped
    // just because node_modules is absent.
    mockExistsSync.mockImplementation((p: unknown) => !String(p).endsWith('node_modules'))
    mockRunCli.mockReturnValue({
      stdout: 'BUILD SUCCESSFUL',
      stderr: '',
      exitCode: 0,
      durationMs: 50,
    })
    const result = runBuildProbe('/some/dir', {
      name: 'gradlew:version',
      command: './gradlew',
      args: ['--version'],
      requires: 'gradlew',
    })
    expect(result.status).toBe('passed')
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

  // ── #855 — exit 0 with compiler errors on stderr is NOT a success ─────────

  it('fails when exit 0 but stderr contains TS compiler error (#855)', () => {
    mockExistsSync.mockReturnValue(true)
    mockRunCli.mockReturnValue({
      stdout: '',
      stderr: 'src/foo.ts(12,5): error TS2322: Type X is not assignable to Y.',
      exitCode: 0,
      durationMs: 100,
    })
    const result = runBuildProbe('/some/dir', {
      name: 'tsc:noEmit',
      command: 'tsc',
      args: ['--noEmit'],
      requires: 'tsconfig.json',
    })
    expect(result.status).toBe('failed')
    expect(result.reason).toContain('compiler errors')
    expect(result.reason).toContain('TS2322')
  })

  it('fails when exit 0 but stderr contains generic "error:" marker (#855)', () => {
    mockExistsSync.mockReturnValue(true)
    mockRunCli.mockReturnValue({
      stdout: '',
      stderr: 'error[E0277]: trait bound not satisfied',
      exitCode: 0,
      durationMs: 100,
    })
    const result = runBuildProbe('/some/dir', {
      name: 'cargo:check',
      command: 'cargo',
      args: ['check'],
      requires: 'Cargo.toml',
    })
    expect(result.status).toBe('failed')
    expect(result.reason).toContain('compiler errors')
  })

  it('passes with stderr-warning trail when exit 0 + stderr non-empty + no error marker (#855)', () => {
    mockExistsSync.mockReturnValue(true)
    mockRunCli.mockReturnValue({
      stdout: '',
      stderr: 'warning: deprecation notice',
      exitCode: 0,
      durationMs: 100,
    })
    const result = runBuildProbe('/some/dir', {
      name: 'gradlew:help',
      command: './gradlew',
      args: ['help'],
      requires: 'gradlew',
    })
    expect(result.status).toBe('passed')
    expect(result.reason).toContain('stderr warnings')
    expect(result.reason).toContain('deprecation')
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

describe('runBuildProbe — notFound → skipped (toolchain-missing, non-fatal) (#1597)', () => {
  it('returns skipped when the build tool is not installed', () => {
    // A missing build tool must be non-fatal, mirroring the version probes'
    // toolchain-missing policy — otherwise a user without (e.g.) ruff or cargo
    // installed fails verification despite a valid project (#1597 gap 1).
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
    expect(result.status).toBe('skipped')
    expect(result.kind).toBe('build')
    expect(result.reason).toBe('toolchain-missing')
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
      stdout: 'ok\n',
      stderr: '',
      exitCode: 0,
      durationMs: 5,
    })
    // Synthetic always-run spec (#1627): NOT a real probe — the dropped ruff build
    // probe was the only requires:'' spec, so name it generically to avoid implying one.
    const result = runBuildProbe('/some/dir', {
      name: 'always-run:probe',
      command: 'noop',
      args: ['--version'],
      requires: '',
    })
    expect(result.status).toBe('passed')
    expect(result.kind).toBe('build')
  })
})

describe('runProbes — unknown stack coverage gap', () => {
  it('emits a skipped probe when detectLanguage returns unknown (no matrix entry)', () => {
    mockDetectLanguage.mockReturnValue('unknown')
    mockExistsSync.mockReturnValue(false)
    const report = runProbes('/some/dir')
    expect(report.stack).toBe('unknown')
    expect(report.probes).toHaveLength(1)
    expect(report.probes[0]?.status).toBe('skipped')
    expect(report.probes[0]?.reason).toMatch(/no matrix coverage for stack 'unknown'/)
    expect(report.hasFailures).toBe(false)
  })

  it('probes the union of the TS and JVM toolchains for multi, never zero-coverage (#1597)', () => {
    // A polyglot monorepo must actually verify both sides, not return a single
    // "no matrix coverage" skipped that prints a false-OK green banner.
    mockDetectLanguage.mockReturnValue('multi')
    mockExistsSync.mockReturnValue(false) // no build files, no githooks
    // Every tool absent → all version probes skip (toolchain-missing), non-fatal.
    mockRunCli.mockImplementation(() => {
      throw new CliError({
        cmd: 'x',
        args: [],
        exitCode: -1,
        stdout: '',
        stderr: '',
        timedOut: false,
        notFound: true,
      })
    })
    const report = runProbes('/some/dir')
    expect(report.stack).toBe('multi')
    // #1627: multi now ALSO runs both build probes (tsc:noEmit + gradlew:version);
    // with no build files on disk they skip at the requires-guard but are still emitted.
    expect(report.probes.map((p) => p.tool)).toEqual([
      'node',
      'npm',
      'java',
      'gradle',
      'mvn',
      'tsc:noEmit',
      'gradlew:version',
    ])
    expect(report.probes.some((p) => /no matrix coverage/.test(p.reason ?? ''))).toBe(false)
    expect(report.hasFailures).toBe(false)
  })

  // #1627: the build layer must union TS+JVM for multi, not silently run nothing.
  it('runs tsc:noEmit + gradlew:version build probes for multi when build files exist (#1627)', () => {
    mockDetectLanguage.mockReturnValue('multi')
    mockExistsSync.mockReturnValue(true) // tsconfig.json + gradlew present → build probes run
    // Build commands exit 0 with empty stderr → passed. (Version probes get empty
    // stdout and may fail to parse, but this test asserts only the build layer.)
    mockRunCli.mockReturnValue({ stdout: '', stderr: '', exitCode: 0, durationMs: 5 })
    const report = runProbes('/some/dir')
    const builds = report.probes.filter((p) => p.kind === 'build')
    expect(builds.map((p) => p.tool)).toEqual(['tsc:noEmit', 'gradlew:version'])
    expect(builds.every((p) => p.status === 'passed')).toBe(true)
  })
})

describe('runProbes — non-npm package manager', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'arbiter-pnpm-probe-'))
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ packageManager: 'pnpm@11.1.1' }))
    mockDetectLanguage.mockReturnValue('typescript')
    mockExistsSync.mockReturnValue(false)
    mockRunCli.mockImplementation((cmd: string) => {
      if (cmd === 'node') return { stdout: 'v22.0.0', stderr: '', exitCode: 0, durationMs: 5 }
      if (cmd === 'npm') throw new Error('npm probe must not run for pnpm projects')
      throw new Error(`unexpected runCli invocation: ${cmd}`)
    })
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('skips the npm version probe with a pnpm-specific reason', () => {
    const report = runProbes(dir)
    const npmProbe = report.probes.find((probe) => probe.tool === 'npm')

    expect(npmProbe).toEqual({
      tool: 'npm',
      status: 'skipped',
      reason: 'package-manager: pnpm is configured for this project — the npm probe does not apply',
    })
    expect(report.probes.some((probe) => probe.tool === 'npm' && probe.status === 'failed')).toBe(
      false,
    )
  })
})

describe('runProbes — kotlin dispatch', () => {
  it('runs java + kotlinc + gradle version probes plus a gradlew:version build probe', () => {
    mockDetectLanguage.mockReturnValue('kotlin')
    mockExistsSync.mockReturnValue(false) // no gradlew on disk → build probe skips (still emitted)
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
    // #1627: kotlin now also gets the gradle-wrapper build probe (reused from java);
    // with no gradlew on disk it skips at the requires-guard but is still emitted.
    expect(report.probes).toHaveLength(4)
    expect(report.probes.map((p) => p.tool)).toEqual([
      'java',
      'kotlinc',
      'gradle',
      'gradlew:version',
    ])
    expect(report.probes.slice(0, 3).every((p) => p.status === 'passed')).toBe(true)
    expect(report.probes[3]?.status).toBe('skipped')
    expect(report.probes[3]?.kind).toBe('build')
    expect(report.hasFailures).toBe(false)
  })

  // #1627: when the gradle wrapper IS present the kotlin build probe actually runs.
  it('runs the gradlew:version build probe for kotlin when gradlew exists (#1627)', () => {
    mockDetectLanguage.mockReturnValue('kotlin')
    mockExistsSync.mockReturnValue(true) // gradlew present → build probe runs
    mockRunCli.mockReturnValue({ stdout: 'Gradle 8.5\n', stderr: '', exitCode: 0, durationMs: 5 })
    const report = runProbes('/some/kotlin/dir')
    const builds = report.probes.filter((p) => p.kind === 'build')
    expect(builds.map((p) => p.tool)).toEqual(['gradlew:version'])
    expect(builds[0]?.status).toBe('passed')
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
    // kotlin probes: 3x runCli (java, kotlinc, gradle); the gradlew:version build probe
    // skips (no gradlew on disk, see existsSync impl below) so it consumes no runCli call.
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
    // gradlew build-probe requires-guard → false (skip); probeHooksPath pre-commit → true
    mockExistsSync.mockImplementation((p) => String(p).includes('.githooks'))

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
