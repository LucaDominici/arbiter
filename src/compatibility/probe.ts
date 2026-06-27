// SPDX-License-Identifier: Apache-2.0
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { runCli, CliError } from '../utils/run-cli.js'
import { detectLanguage } from '../detectors/language.js'
import { matches, UnparseableConstraintError, validateRanges } from './matcher.js'
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
import type { Language } from '../wizard/types.js'
import type { LanguageMatrix, MatrixEntry, ProbeResult, VerifyReport } from './schema.js'
import { makeVerifyReport } from './schema.js'
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

function parseTimeoutEnv(name: string, fallback: number): number {
  const raw = process.env[name]
  if (raw === undefined || raw === '') return fallback
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

const PROBE_TIMEOUT_MS = parseTimeoutEnv('ARBITER_PROBE_TIMEOUT_MS', 10_000)
const BUILD_PROBE_TIMEOUT_MS = parseTimeoutEnv('ARBITER_BUILD_PROBE_TIMEOUT_MS', 60_000)

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

// Per-stack build-invocation probe specs (run in the target project directory after
// generation). Defined as named constants so the polyglot `multi` and `kotlin` stacks
// can REUSE them instead of needing their own keyed entry (#1627).
//
// No python build probe: it ran `ruff --version` (requires:'' → always), duplicating the
// matrix version probe for ruff and adding zero signal — yet diverged from it when ruff
// was absent (version probe skipped, build probe failed → false verify failure). Dropped
// in favour of the single version probe (#1597 gap 1).
const TSC_BUILD_PROBE: BuildProbeSpec = {
  name: 'tsc:noEmit',
  command: 'npx',
  args: ['tsc', '--noEmit'],
  requires: 'tsconfig.json',
}
const GRADLEW_BUILD_PROBE: BuildProbeSpec = {
  name: 'gradlew:version',
  command: './gradlew',
  args: ['--version'],
  requires: 'gradlew',
}
const CARGO_BUILD_PROBE: BuildProbeSpec = {
  name: 'cargo:check',
  command: 'cargo',
  args: ['check'],
  requires: 'Cargo.toml',
}
const GO_BUILD_PROBE: BuildProbeSpec = {
  name: 'go:build',
  command: 'go',
  args: ['build', '-n', './...'],
  requires: 'go.mod',
}

/**
 * Resolve the build-invocation probes to run for a detected stack, mirroring
 * `matrixEntriesFor` (#1627). A `multi` polyglot monorepo unions the TypeScript
 * type-check (`tsc:noEmit`) and the JVM gradle-wrapper resolution (`gradlew:version`)
 * so it actually exercises BOTH builds; `kotlin` reuses the gradle-wrapper probe (its
 * build is structurally identical to the Java/Gradle one). The previous flat
 * `BUILD_PROBE_SPECS[lang]` lookup had no `multi`/`kotlin` key, so those two stacks
 * silently ran NO build probe — strictly weaker than single-TS/Java. Unknown/uncovered
 * stacks (e.g. `python`) return [].
 */
function buildProbesFor(lang: Language): BuildProbeSpec[] {
  switch (lang) {
    case 'typescript':
      return [TSC_BUILD_PROBE]
    case 'java':
    case 'kotlin':
      return [GRADLEW_BUILD_PROBE]
    case 'rust':
      return [CARGO_BUILD_PROBE]
    case 'go':
      return [GO_BUILD_PROBE]
    case 'multi':
      return [TSC_BUILD_PROBE, GRADLEW_BUILD_PROBE]
    default:
      return []
  }
}

/**
 * Matches a CLI error meaning the tool does not recognise the `--version` flag
 * (Click "No such option: --version" / argparse "unrecognized arguments:
 * --version" / generic "unknown option ... --version"). Such a tool is present
 * but its version is unprobeable, so the probe skips rather than fails (#1597).
 */
const VERSION_FLAG_UNSUPPORTED =
  /(no such option|unrecognized arguments?|unknown option|invalid option)[^\n]*--version/i

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
      // A tool that rejects `--version` as an unknown option (Click "No such
      // option: --version", argparse "unrecognized arguments: --version") is
      // present but unprobeable — e.g. import-linter only added --version in
      // 2.11, so installs in [2.0, 2.10] error here. That is not an invalid
      // toolchain; skip rather than hard-fail verification (#1597 gap 3).
      if (VERSION_FLAG_UNSUPPORTED.test(detail)) {
        return {
          tool,
          status: 'skipped',
          reason:
            'version-flag-unsupported: tool does not support --version (cannot probe version)',
        }
      }
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

  let inRange: boolean
  try {
    inRange = matches(version, range)
  } catch (err) {
    // #854 — surface matrix-author bugs as 'matrix-bug', not 'version outside range'
    if (err instanceof UnparseableConstraintError) {
      return {
        tool,
        status: 'failed',
        version,
        reason: `matrix-bug: ${err.message}`,
      }
    }
    throw err
  }
  if (!inRange) {
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

// #854 — validate every range in the matrix at load time so author bugs
// surface immediately instead of as misleading "version outside range"
// errors at user-probe time.
function assertMatrixRangesParseable(matrix: LanguageMatrix): void {
  const allEntries: Array<{ tool: string; range: string }> = []
  for (const key of REQUIRED_MATRIX_KEYS) {
    for (const entry of matrix[key]) {
      allEntries.push({ tool: entry.tool, range: entry.range })
    }
  }
  const failures = validateRanges(allEntries)
  if (failures.length > 0) {
    const summary = failures.map((f) => `  ${f.tool}: ${f.reason}`).join('\n')
    throw new Error(`matrix.json contains ${failures.length} unparseable range(s):\n${summary}`)
  }
}
assertMatrixRangesParseable(MATRIX)

/**
 * Patterns matching compiler-error markers across tsc / cargo / go build /
 * javac / kotlinc / rustc stderr output (#855). A match means the build
 * tool printed errors even though it exited 0 (legitimate edge case in
 * dry-run / partial-graph modes); treat as failure to prevent silent
 * shipping of broken builds.
 */
const CompilerErrorPatterns: readonly RegExp[] = [
  /\berror(\[E\d+\])?:/i,
  /\bTS\d{4,}:/, // TypeScript diagnostics
  /\bFAILED\b/,
  /\bfatal error\b/i,
  /compilation (failed|error)/i,
]

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
    const result = runCli(spec.command, spec.args, {
      cwd: dir,
      timeoutMs: BUILD_PROBE_TIMEOUT_MS,
    })
    // #855 — zero exit ≠ success. Compiler diagnostics on stderr with exit 0
    // are possible for tsc/cargo/go build edge cases. Treat stderr matching
    // a compiler-error marker as failure; surface other stderr content as
    // a warning trail in the reason field.
    const stderr = result.stderr.trim()
    if (stderr !== '' && CompilerErrorPatterns.some((p) => p.test(stderr))) {
      return {
        tool: spec.name,
        status: 'failed',
        kind: 'build',
        reason: `exit 0 with compiler errors on stderr: ${stderr.slice(0, 500)}`,
      }
    }
    if (stderr !== '') {
      return {
        tool: spec.name,
        status: 'passed',
        kind: 'build',
        reason: `stderr warnings (exit 0): ${stderr.slice(0, 200)}`,
      }
    }
    return { tool: spec.name, status: 'passed', kind: 'build' }
  } catch (err) {
    if (err instanceof CliError) {
      if (err.notFound) {
        // A missing build tool is non-fatal, mirroring the version probes'
        // toolchain-missing policy — a user without the tool installed should
        // skip, not fail verification (#1597 gap 1).
        return {
          tool: spec.name,
          status: 'skipped',
          kind: 'build',
          reason: 'toolchain-missing',
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
 * Resolve the matrix entries to probe for a detected stack. A `multi` polyglot
 * monorepo unions the TypeScript and JVM (Java) toolchains so it actually
 * verifies both sides instead of returning zero coverage and printing a
 * false-OK green banner (#1597 gap 2). Unknown/uncovered stacks return [].
 */
function matrixEntriesFor(lang: Language): MatrixEntry[] {
  switch (lang) {
    case 'typescript':
      return MATRIX.typescript
    case 'java':
      return MATRIX.java
    case 'kotlin':
      return MATRIX.kotlin
    case 'rust':
      return MATRIX.rust
    case 'go':
      return MATRIX.go
    case 'python':
      return MATRIX.python
    case 'multi':
      return [...MATRIX.typescript, ...MATRIX.java]
    default:
      return []
  }
}

/**
 * Run all tool probes for the detected stack in the given directory.
 * Runs version probes first, then a per-stack build probe.
 */
export function runProbes(dir: string): VerifyReport {
  const lang = detectLanguage(dir)

  const entries: MatrixEntry[] = matrixEntriesFor(lang)

  const probes: ProbeResult[] = entries.map(({ tool, range }) => {
    const spec = TOOL_SPECS[tool]
    if (!spec) {
      return { tool, status: 'failed', reason: `no spec for tool: ${tool}` }
    }
    return probeTool(tool, spec.args, range, spec.channel)
  })

  if (entries.length === 0) {
    probes.push({
      tool: 'matrix',
      status: 'skipped',
      reason: `no matrix coverage for stack '${lang}'`,
    })
  }

  for (const buildSpec of buildProbesFor(lang)) {
    probes.push(runBuildProbe(dir, buildSpec))
  }

  const hooksProbe = probeHooksPath(dir)
  if (hooksProbe !== null) {
    probes.push(hooksProbe)
  }

  // Derive hasFailures/hasWarnings in the one sanctioned place (the factory) so the two summary
  // booleans can never drift out of sync with `probes` (#1533).
  return makeVerifyReport(dir, lang, probes)
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
