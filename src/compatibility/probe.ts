import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { runCli, CliError } from '../utils/run-cli.js'
import { detectLanguage } from '../detectors/language.js'
import { matches } from './matcher.js'
import {
  parseNodeVersion,
  parseNpmVersion,
  parseJavaVersion,
  parseGradleVersion,
  parseMavenVersion,
  parseRustVersion,
  parseCargoVersion,
  parseGoVersion,
  parsePythonVersion,
  parsePipVersion,
  parseRuffVersion,
  parseLintImportsVersion,
  parseKotlinVersion,
} from './parsers.js'
import type { SemVer } from './parsers.js'
import type { LanguageMatrix, MatrixEntry, ProbeResult, VerifyReport } from './schema.js'
import matrixJson from './matrix.json' with { type: 'json' }

type OutputChannel = 'stdout' | 'stderr'

interface ToolSpec {
  args: readonly string[]
  channel: OutputChannel
  parse: (raw: string) => SemVer | null
}

const TOOL_SPECS: Record<string, ToolSpec> = {
  node: { args: ['--version'], channel: 'stdout', parse: parseNodeVersion },
  npm: { args: ['--version'], channel: 'stdout', parse: parseNpmVersion },
  java: { args: ['-version'], channel: 'stderr', parse: parseJavaVersion },
  gradle: {
    args: ['--version'],
    channel: 'stdout',
    parse: parseGradleVersion,
  },
  mvn: { args: ['--version'], channel: 'stdout', parse: parseMavenVersion },
  rustc: { args: ['--version'], channel: 'stdout', parse: parseRustVersion },
  cargo: { args: ['--version'], channel: 'stdout', parse: parseCargoVersion },
  go: { args: ['version'], channel: 'stdout', parse: parseGoVersion },
  python3: {
    args: ['--version'],
    channel: 'stdout',
    parse: parsePythonVersion,
  },
  pip: { args: ['--version'], channel: 'stdout', parse: parsePipVersion },
  ruff: { args: ['--version'], channel: 'stdout', parse: parseRuffVersion },
  'lint-imports': {
    args: ['--version'],
    channel: 'stdout',
    parse: parseLintImportsVersion,
  },
  kotlinc: {
    args: ['-version'],
    channel: 'stderr',
    parse: parseKotlinVersion,
  },
}

const PROBE_TIMEOUT_MS = 10_000
const BUILD_PROBE_TIMEOUT_MS = 60_000

/** Specification for a build-invocation probe (runs in target project directory) */
export interface BuildProbeSpec {
  /** Probe identifier used in output, e.g. "gradlew:help" */
  name: string
  /** Executable to run */
  command: string
  /** Arguments to pass */
  args: readonly string[]
  /**
   * Relative path (within target dir) that must exist before running.
   * Empty string means always run (no file guard).
   */
  requires: string
}

/** Per-stack build probe specs. Run in target project directory after generation. */
const BUILD_PROBE_SPECS: Record<string, BuildProbeSpec> = {
  typescript: {
    name: 'tsc:noEmit',
    command: 'npx',
    args: ['tsc', '--noEmit'],
    requires: 'tsconfig.json',
  },
  java: {
    name: 'gradlew:version',
    command: './gradlew',
    args: ['--version'],
    requires: 'gradlew',
  },
  rust: {
    name: 'cargo:check',
    command: 'cargo',
    args: ['check'],
    requires: 'Cargo.toml',
  },
  go: {
    name: 'go:build',
    command: 'go',
    args: ['build', '-n', './...'],
    requires: 'go.mod',
  },
  python: {
    name: 'ruff:version',
    command: 'ruff',
    args: ['--version'],
    requires: '',
  },
}

/**
 * Probe a single tool: run its version command and check against the range.
 * Exported for unit testing.
 */
export function probeTool(
  tool: string,
  args: readonly string[],
  range: string,
  channel: OutputChannel,
): ProbeResult {
  const spec = TOOL_SPECS[tool]
  if (!spec) {
    return { tool, status: 'failed', reason: `no spec for tool: ${tool}` }
  }
  const parse = spec.parse

  let raw: string
  try {
    const result = runCli(tool, args, { timeoutMs: PROBE_TIMEOUT_MS })
    raw = channel === 'stderr' ? result.stderr : result.stdout
  } catch (err) {
    if (err instanceof CliError) {
      if (err.notFound) {
        return { tool, status: 'skipped', reason: 'toolchain-missing' }
      }
      if (err.timedOut) {
        return {
          tool,
          status: 'failed',
          reason: `probe timeout (${PROBE_TIMEOUT_MS}ms)`,
        }
      }
      const detail = (err.stderr || err.stdout || err.message).trim().slice(0, 500)
      return {
        tool,
        status: 'failed',
        reason: `exit ${err.exitCode}: ${detail}`,
      }
    }
    throw err
  }

  const version = parse(raw)
  if (version === null) {
    return {
      tool,
      status: 'failed',
      reason: `unrecognized version output: ${raw.trim().slice(0, 60)}`,
    }
  }

  if (!matches(version, range)) {
    return {
      tool,
      status: 'failed',
      version,
      reason: `version ${version.major}.${version.minor} outside ${range}`,
    }
  }

  return { tool, status: 'passed', version }
}

const REQUIRED_MATRIX_KEYS: ReadonlyArray<keyof LanguageMatrix> = [
  'typescript',
  'java',
  'kotlin',
  'rust',
  'go',
  'python',
]

/** exported for tests */
export function validateMatrix(raw: unknown): LanguageMatrix {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error('matrix.json: root must be an object')
  }
  const obj = raw as Record<string, unknown>
  for (const key of REQUIRED_MATRIX_KEYS) {
    const arr = obj[key]
    if (!Array.isArray(arr)) {
      throw new Error(`matrix.json: ${key} must be an array`)
    }
    arr.forEach((entry, i) => {
      if (typeof entry !== 'object' || entry === null) {
        throw new Error(`matrix.json: ${key}[${i}] must be an object`)
      }
      const e = entry as Record<string, unknown>
      if (typeof e.tool !== 'string') {
        throw new Error(`matrix.json: ${key}[${i}].tool expected string, got ${typeof e.tool}`)
      }
      if (typeof e.range !== 'string') {
        throw new Error(`matrix.json: ${key}[${i}].range expected string, got ${typeof e.range}`)
      }
    })
  }
  return obj as unknown as LanguageMatrix
}

const MATRIX = validateMatrix(matrixJson)

/**
 * Run a build-invocation probe in the target directory.
 * Returns skipped if the required file guard is missing.
 * Exported for unit testing.
 */
export function runBuildProbe(dir: string, spec: BuildProbeSpec): ProbeResult {
  if (spec.requires !== '' && !existsSync(join(dir, spec.requires))) {
    return {
      tool: spec.name,
      status: 'skipped',
      kind: 'build',
      reason: `build-file-not-found: ${spec.requires}`,
    }
  }

  try {
    runCli(spec.command, spec.args, {
      cwd: dir,
      timeoutMs: BUILD_PROBE_TIMEOUT_MS,
    })
    return { tool: spec.name, status: 'passed', kind: 'build' }
  } catch (err) {
    if (err instanceof CliError) {
      if (err.notFound) {
        return {
          tool: spec.name,
          status: 'failed',
          kind: 'build',
          reason: `build tool missing: ${spec.command}`,
        }
      }
      if (err.timedOut) {
        return {
          tool: spec.name,
          status: 'failed',
          kind: 'build',
          reason: `build timeout (${BUILD_PROBE_TIMEOUT_MS}ms)`,
        }
      }
      const detail = (err.stderr || err.stdout || err.message).trim().slice(0, 500)
      return {
        tool: spec.name,
        status: 'failed',
        kind: 'build',
        reason: `exit ${err.exitCode}: ${detail}`,
      }
    }
    throw err
  }
}

/**
 * Run all tool probes for the detected stack in the given directory.
 * Runs version probes first, then a per-stack build probe.
 */
export function runProbes(dir: string): VerifyReport {
  const lang = detectLanguage(dir)

  const entries: MatrixEntry[] =
    lang === 'typescript'
      ? MATRIX.typescript
      : lang === 'java'
        ? MATRIX.java
        : lang === 'kotlin'
          ? MATRIX.kotlin
          : lang === 'rust'
            ? MATRIX.rust
            : lang === 'go'
              ? MATRIX.go
              : lang === 'python'
                ? MATRIX.python
                : []

  const probes: ProbeResult[] = entries.map(({ tool, range }) => {
    const spec = TOOL_SPECS[tool]
    if (!spec) {
      return { tool, status: 'failed', reason: `no spec for tool: ${tool}` }
    }
    return probeTool(tool, spec.args, range, spec.channel)
  })

  const buildSpec = BUILD_PROBE_SPECS[lang]
  if (buildSpec !== undefined) {
    probes.push(runBuildProbe(dir, buildSpec))
  }

  const hooksProbe = probeHooksPath(dir)
  if (hooksProbe !== null) {
    probes.push(hooksProbe)
  }

  const hasFailures = probes.some((p) => p.status === 'failed')
  const hasWarnings = probes.some((p) => p.status === 'warning')

  return { dir, stack: lang, probes, hasFailures, hasWarnings }
}

/**
 * Probe whether `.githooks/pre-commit` exists but `core.hooksPath` is not set to `.githooks`.
 * Returns null (silent skip) if no `.githooks/` directory is present at all.
 * Exported for unit testing.
 */
export function probeHooksPath(dir: string): ProbeResult | null {
  const preCommitPath = join(dir, '.githooks', 'pre-commit')
  if (!existsSync(preCommitPath)) {
    return null
  }

  let configuredPath: string | null
  try {
    const result = runCli('git', ['config', '--get', 'core.hooksPath'], {
      cwd: dir,
      timeoutMs: PROBE_TIMEOUT_MS,
    })
    configuredPath = result.stdout.trim()
  } catch {
    // git config --get exits non-zero when key is absent — treat as not set
    configuredPath = null
  }

  if (configuredPath === '.githooks') {
    return { tool: 'hooksPath', status: 'passed' }
  }

  return {
    tool: 'hooksPath',
    status: 'warning',
    reason:
      '.githooks/pre-commit exists but core.hooksPath is not set to .githooks. ' +
      'Run: git config core.hooksPath .githooks (or ./scripts/setup-hooks.sh for non-Node projects).',
  }
}
