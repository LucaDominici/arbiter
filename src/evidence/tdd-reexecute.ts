// SPDX-License-Identifier: Apache-2.0
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { isAbsolute, join, resolve, sep, win32 } from 'node:path'
import { CliError, runCli } from '../utils/run-cli.js'
import {
  combineTestOutput,
  extractFailureIdentities,
  extractFailureSignature,
  repositoryRelativeLog,
  type TddEvidence,
} from './tdd.js'
import { blobShaInCommit, gitCwd, resolveEvidenceCommit } from './git-checks.js'
import { mkdtempTranslated, rmTranslated, symlinkTranslated } from '../utils/fs.js'

function resolveRecordedTestCwd(repoDir: string, cwdRelative?: string): string | null {
  const recorded = cwdRelative ?? '.'
  if (isAbsolute(recorded) || win32.isAbsolute(recorded)) return null
  if (recorded.split(/[\\/]/).some((segment) => segment === '..' || segment === '')) return null
  return resolve(repoDir, recorded)
}

export interface RedExecutionResult {
  ok: boolean
  reason?: string
}

const ZERO_TEST_OUTPUT =
  /\b(?:no test files found|no tests ran|collected 0 items|0 tests? (?:run|executed)|no tests? to run|\[no test files\])\b/i

function countSummary(output: string, label: string): number {
  const pattern = new RegExp(`\\b(\\d+)\\s+(?:${label})\\b`, 'gi')
  return [...output.matchAll(pattern)].reduce((sum, match) => sum + Number(match[1]), 0)
}

function goJsonCounts(output: string): { passed: number; skipped: number } {
  let passed = 0
  let skipped = 0
  for (const line of output.split(/\r?\n/)) {
    try {
      const event = JSON.parse(line) as { Action?: string; Test?: string }
      if (!event.Test) continue
      if (event.Action === 'pass') passed++
      if (event.Action === 'skip') skipped++
    } catch {
      // Non-JSON runner chatter cannot establish or erase a test verdict.
    }
  }
  return { passed, skipped }
}

function goOutputFailure(output: string): string | null {
  const counts = goJsonCounts(output)
  if (counts.skipped > 0) return 'recorded Go test was skipped; no GREEN proof exists'
  return counts.passed > 0 ? null : 'recorded Go command reported no passing tests'
}

function tapOutputFailure(output: string): string | null {
  const passed = Number(/^# pass (\d+)$/m.exec(output)?.[1] ?? 0)
  const skipped = Number(/^# skipped (\d+)$/m.exec(output)?.[1] ?? 0)
  const todo = Number(/^# todo (\d+)$/m.exec(output)?.[1] ?? 0)
  if (skipped > 0 || todo > 0) return 'recorded TAP command contains skipped or todo tests'
  return passed > 0 ? null : 'recorded TAP command reported no passing tests'
}

function countedOutputFailure(framework: string, output: string): string | null {
  const passed = countSummary(output, 'passed')
  const skipped = countSummary(output, 'skipped|ignored|pending|todo')
  if (skipped > 0) return 'recorded test command contains skipped tests; no GREEN proof exists'
  if (passed > 0) return null

  return `recorded ${framework} command reported no passing tests`
}

interface GradleXmlSnapshot {
  mtimeMs: number
  content: string
}

function gradleXmlSnapshots(
  root: string,
  parentNativeResults = false,
): Map<string, GradleXmlSnapshot> {
  const files = new Map<string, GradleXmlSnapshot>()
  if (!existsSync(root)) return files
  const parts = root.replaceAll('\\', '/').split('/')
  const inNativeResults =
    parentNativeResults || (parts.at(-1) === 'test-results' && parts.at(-2) === 'build')
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name)
    if (entry.isDirectory() && entry.name !== 'node_modules' && entry.name !== '.git') {
      for (const [file, snapshot] of gradleXmlSnapshots(path, inNativeResults))
        files.set(file, snapshot)
    } else if (inNativeResults && /^TEST-.*\.xml$/i.test(entry.name)) {
      try {
        files.set(path, { mtimeMs: statSync(path).mtimeMs, content: readFileSync(path, 'utf8') })
      } catch {
        // A concurrently removed result cannot establish a fresh verdict.
      }
    }
  }
  return files
}

function freshGradleXml(root: string, before: Map<string, GradleXmlSnapshot>): string[] {
  return [...gradleXmlSnapshots(root)]
    .filter(([path, snapshot]) => {
      const previous = before.get(path)
      return (
        previous === undefined ||
        snapshot.mtimeMs > previous.mtimeMs ||
        snapshot.content !== previous.content
      )
    })
    .map(([, snapshot]) => snapshot.content)
}

function xmlCount(attributes: string, name: string): number | null {
  const value = new RegExp(`\\b${name}="(\\d+)"`, 'i').exec(attributes)?.[1]
  return value === undefined ? null : Number(value)
}

interface GradleXmlCounts {
  tests: number
  failures: number
  errors: number
  skipped: number
}

function gradleSuiteCounts(attributes: string, body: string): GradleXmlCounts {
  const countTags = (tag: string): number =>
    [...body.matchAll(new RegExp(`<${tag}\\b`, 'gi'))].length
  return {
    tests: xmlCount(attributes, 'tests') ?? countTags('testcase'),
    failures: Math.max(xmlCount(attributes, 'failures') ?? 0, countTags('failure')),
    errors: Math.max(xmlCount(attributes, 'errors') ?? 0, countTags('error')),
    skipped: Math.max(xmlCount(attributes, 'skipped') ?? 0, countTags('skipped')),
  }
}

function gradleXmlFailure(xml: readonly string[]): string | null {
  if (xml.length === 0) return 'Gradle replay produced no fresh TEST-*.xml results'

  let tests = 0
  let failures = 0
  let errors = 0
  let skipped = 0
  for (const document of xml) {
    const suites = [
      ...document.matchAll(/<testsuite\b([^>]*?)(?:\/\s*>|>([\s\S]*?)<\/testsuite>)/gi),
    ]
    if (suites.length === 0) return 'Gradle replay produced invalid JUnit XML'
    for (const suite of suites) {
      const attributes = suite[1] ?? ''
      const body = suite[2] ?? ''
      const counts = gradleSuiteCounts(attributes, body)
      tests += counts.tests
      failures += counts.failures
      errors += counts.errors
      skipped += counts.skipped
    }
  }
  if (tests === 0) return 'fresh Gradle/JUnit results reported zero tests'
  if (skipped > 0) return 'fresh Gradle/JUnit results contain skipped tests'
  if (failures > 0 || errors > 0) return 'fresh Gradle/JUnit results contain failing tests'
  if (tests - failures - errors <= 0) return 'fresh Gradle/JUnit results reported no passing tests'
  return null
}

function greenOutputFailure(
  ev: TddEvidence,
  output: string,
  freshGradleResults?: readonly string[],
): string | null {
  if (ZERO_TEST_OUTPUT.test(output)) return 'recorded test command reported zero tests'
  const framework = extractFailureSignature(ev.test_run_log)?.framework
  if (framework === undefined) return 'recorded RED framework is unrecognized'
  if (framework === 'go') return goOutputFailure(output)
  if (framework === 'tap') return tapOutputFailure(output)
  if (framework === 'gradle') return gradleXmlFailure(freshGradleResults ?? [])
  return countedOutputFailure(framework, output)
}

function matchesRecordedTestContent(path: string, expected: string | undefined): boolean {
  if (expected === undefined) return true
  try {
    const content = readFileSync(path)
    const actual = createHash('sha1')
      .update(`blob ${content.byteLength}\0`)
      .update(content)
      .digest('hex')
    return actual === expected
  } catch {
    return false
  }
}

function expectedGreenTestBlob(ev: TddEvidence, repoDir: string): string | null | undefined {
  if (ev.test_blob_sha !== undefined) return ev.test_blob_sha
  if (!existsSync(join(repoDir, '.git'))) return undefined
  const resolved = resolveEvidenceCommit(ev, repoDir)
  if (resolved === null || 'degraded' in resolved) return null
  return blobShaInCommit(resolved.sha, ev.test_path, repoDir)
}

function gradleSnapshotBefore(
  framework: string | undefined,
  root: string,
): Map<string, GradleXmlSnapshot> {
  return framework === 'gradle' ? gradleXmlSnapshots(root) : new Map<string, GradleXmlSnapshot>()
}

function greenTestPathFailure(repoDir: string, ev: TddEvidence): string | null {
  const testPath = resolve(repoDir, ev.test_path)
  if (!testPath.startsWith(`${repoDir}${sep}`) || !existsSync(testPath)) {
    return `recorded test_path "${ev.test_path}" is missing from the current checkout`
  }
  const expectedBlob = expectedGreenTestBlob(ev, repoDir)
  if (expectedBlob === null) {
    return `recorded RED test content for "${ev.test_path}" is unavailable from the RED commit`
  }
  if (expectedBlob !== undefined && !matchesRecordedTestContent(testPath, expectedBlob)) {
    return `recorded RED test content at "${ev.test_path}" differs from the current checkout`
  }
  return null
}

function greenFailureAfterRun(
  ev: TddEvidence,
  framework: string | undefined,
  output: string,
  gradleRoot: string,
  beforeGradleResults: Map<string, GradleXmlSnapshot>,
): string | null {
  if (framework === 'gradle') {
    return greenOutputFailure(ev, output, freshGradleXml(gradleRoot, beforeGradleResults))
  }
  return greenOutputFailure(ev, output)
}

function greenArgs(testCommand: readonly string[], framework: string | undefined): string[] {
  const [cmd, ...args] = testCommand
  const name = cmd?.replaceAll('\\', '/').split('/').at(-1)
  if (framework === 'go' && name === 'go' && args[0] === 'test' && !args.includes('-json')) {
    return [args[0], '-json', ...args.slice(1)]
  }
  return args
}

function greenCliFailure(err: CliError, cmd: string, timeoutMs: number): string {
  if (err.outputTruncated) return 'recorded test command exceeded its output buffer limit'
  if (err.timedOut) return `recorded test command timed out after ${timeoutMs}ms`
  if (err.notFound) return `recorded test command is unavailable: ${cmd}`
  if (err.signal !== null) return `recorded test command was interrupted by ${err.signal}`
  if (err.exitCode === 137 || err.exitCode === 134) {
    return `recorded test command was interrupted or hit a resource failure (exit ${err.exitCode})`
  }
  return `recorded test still fails (exit ${err.exitCode})`
}

/** Default timeout for the re-run itself. Matches record-red's own default (#1951). */
export const DEFAULT_REEXEC_TIMEOUT_MS = 120_000

/**
 * Re-derive the recorded RED phase from source instead of trusting the
 * evidence file's own prose. Checks out `test_commit_sha` into an isolated,
 * detached git worktree (never touches the caller's working tree) and
 * re-runs the exact recorded `test_command` there. The complete failure identity
 * derived from both logs must match, independent of runner output order. V1's
 * scalar observed_failure remains supported and must agree with its saved log;
 * no evidence migration or duplicate identity field is needed.
 *
 * Closes the false-green found in a downstream project (#1957): evidence
 * named a specific failing test whose `test_commit_sha` predated the test's
 * own existence — the file existed at that commit, the test did not. Neither
 * `sha-on-branch` nor `test-path-in-commit` re-run anything, so both passed
 * anyway. Re-executing the recorded command against the recorded commit's
 * real source is the only check that can catch this: at that commit the
 * named test either doesn't run at all (and the rest of the file/package
 * was already green) or fails differently — either way the recorded failure
 * cannot be reproduced.
 */
export function verifyRedExecution(
  ev: TddEvidence,
  dir?: string,
  timeoutMs: number = DEFAULT_REEXEC_TIMEOUT_MS,
): RedExecutionResult {
  const testCommand = ev.test_command
  if (testCommand === undefined || testCommand.length === 0) {
    return {
      ok: false,
      reason:
        'evidence has no recorded test_command — legacy evidence predating #1957 cannot be ' +
        're-verified against source; re-record with `arbiter lifecycle record-red` to upgrade',
    }
  }

  const repoDir = resolve(gitCwd(dir))
  const worktreeDir = freeTempPath()
  try {
    const added = addDetachedWorktree(repoDir, worktreeDir, ev.test_commit_sha)
    if (!added.ok) return added

    const replayCwd = resolveRecordedTestCwd(worktreeDir, ev.test_cwd)
    if (replayCwd === null) {
      return {
        ok: false,
        reason: `recorded test_cwd "${ev.test_cwd ?? ''}" is not repository-relative`,
      }
    }

    linkNodeModules(repoDir, worktreeDir, ev.test_cwd ?? '.')

    const freshLog = runTestCommand(testCommand, replayCwd, worktreeDir, timeoutMs)
    return compareFailure(ev, repositoryRelativeLog(freshLog, worktreeDir))
  } finally {
    removeDetachedWorktree(repoDir, worktreeDir)
  }
}

/** Prove that the exact command which established RED now passes in the current checkout. */
export function verifyGreenExecution(
  ev: TddEvidence,
  dir?: string,
  timeoutMs: number = DEFAULT_REEXEC_TIMEOUT_MS,
): RedExecutionResult {
  const testCommand = ev.test_command
  if (testCommand === undefined || testCommand.length === 0) {
    return { ok: false, reason: 'evidence has no recorded test_command; re-record RED evidence' }
  }

  const repoDir = resolve(dir ?? process.cwd())
  const replayCwd = resolveRecordedTestCwd(repoDir, ev.test_cwd)
  if (replayCwd === null) {
    return {
      ok: false,
      reason: `recorded test_cwd "${ev.test_cwd ?? ''}" is not repository-relative`,
    }
  }
  const testPathFailure = greenTestPathFailure(repoDir, ev)
  if (testPathFailure !== null) return { ok: false, reason: testPathFailure }

  const [cmd] = testCommand
  if (cmd === undefined) return { ok: false, reason: 'evidence has no recorded test_command' }
  const executable = replayExecutable(cmd, replayCwd, repoDir)
  if (executable === null) {
    return {
      ok: false,
      reason: `recorded test executable "${cmd}" resolves outside the repository`,
    }
  }

  try {
    const framework = extractFailureSignature(ev.test_run_log)?.framework
    const args = greenArgs(testCommand, framework)
    const gradleRoot = replayCwd
    const beforeGradleResults = gradleSnapshotBefore(framework, gradleRoot)
    const result = runCli(executable, args, { cwd: replayCwd, timeoutMs })
    const failure = greenFailureAfterRun(
      ev,
      framework,
      combineTestOutput(result.stdout, result.stderr),
      gradleRoot,
      beforeGradleResults,
    )
    return failure === null ? { ok: true } : { ok: false, reason: failure }
  } catch (err) {
    if (!(err instanceof CliError)) {
      return { ok: false, reason: `recorded test command could not run: ${String(err)}` }
    }
    return { ok: false, reason: greenCliFailure(err, cmd, timeoutMs) }
  }
}

function compareFailure(ev: TddEvidence, freshLog: string): RedExecutionResult {
  const fresh = extractFailureIdentities(freshLog)
  if (fresh.length === 0) {
    return {
      ok: false,
      reason:
        `test_command [${ev.test_command?.join(' ') ?? ''}] did not fail when re-run at ` +
        `test_commit_sha ${ev.test_commit_sha} — the recorded RED phase could not be ` +
        'reproduced from source (false-green risk)',
    }
  }
  const recordedSig = extractFailureSignature(ev.test_run_log)
  if (
    recordedSig === null ||
    JSON.stringify(extractFailureIdentities(recordedSig.match)) !==
      JSON.stringify(extractFailureIdentities(ev.observed_failure))
  ) {
    return { ok: false, reason: 'recorded observed_failure contradicts test_run_log' }
  }
  const recorded = extractFailureIdentities(ev.test_run_log)
  if (JSON.stringify(fresh) !== JSON.stringify(recorded)) {
    return {
      ok: false,
      reason:
        `re-run at test_commit_sha ${ev.test_commit_sha} failed with ${JSON.stringify(fresh)}, not ` +
        `the recorded observed_failure identities ${JSON.stringify(recorded)} — a named failure may not ` +
        'have existed at that commit',
    }
  }
  return { ok: true }
}

/** A unique path that does not exist yet — `git worktree add` creates it. */
function freeTempPath(): string {
  const d = mkdtempTranslated(join(tmpdir(), 'arbiter-tdd-verify-'))
  rmTranslated(d, { recursive: true, force: true })
  return d
}

function addDetachedWorktree(
  repoDir: string,
  worktreeDir: string,
  sha: string,
): { ok: true } | { ok: false; reason: string } {
  try {
    const r = runCli('git', ['worktree', 'add', '--detach', '--force', worktreeDir, sha], {
      cwd: repoDir,
      timeoutMs: 30_000,
    })
    if (r.exitCode !== 0) {
      return {
        ok: false,
        reason: `failed to check out test_commit_sha ${sha} in an isolated worktree: ${r.stderr.trim()}`,
      }
    }
    return { ok: true }
  } catch (err) {
    const detail = err instanceof CliError ? err.stderr || err.message : String(err)
    return {
      ok: false,
      reason: `failed to check out test_commit_sha ${sha} in an isolated worktree: ${detail}`,
    }
  }
}

/**
 * Reuse the caller's installed node_modules so the re-run proves the
 * recorded SOURCE at test_commit_sha genuinely fails, not that packages can
 * be reinstalled offline. Go/Python resolve dependencies outside the repo
 * tree (module cache / PATH), so no equivalent link is needed there.
 */
function linkNodeModulesAt(sourceDir: string, worktreeDir: string, cwdRelative: string): void {
  const src = join(sourceDir, cwdRelative, 'node_modules')
  const dest = join(worktreeDir, cwdRelative, 'node_modules')
  if (!existsSync(src) || existsSync(dest)) return
  try {
    symlinkTranslated(src, dest, 'dir')
    // FAIL-OPEN-INTENT: a missing link surfaces downstream as a genuine check failure (npx can't resolve the runner), never a false PASS.
  } catch {
    // no-op — see FAIL-OPEN-INTENT above
  }
}

function linkNodeModules(sourceDir: string, worktreeDir: string, cwdRelative: string): void {
  linkNodeModulesAt(sourceDir, worktreeDir, '.')
  if (cwdRelative !== '.') linkNodeModulesAt(sourceDir, worktreeDir, cwdRelative)
}

function replayExecutable(cmd: string, cwd: string, worktreeDir: string): string | null {
  const normalized = cmd.replaceAll('\\', '/')
  const localBin = /(?:^|\/)node_modules\/\.bin\/([^/]+)$/.exec(normalized)?.[1]
  if (localBin === undefined || localBin === '.' || localBin === '..') return cmd
  if (isAbsolute(cmd) || win32.isAbsolute(cmd)) {
    return join(cwd, 'node_modules', '.bin', localBin)
  }
  const executable = resolve(cwd, normalized)
  const root = resolve(worktreeDir)
  return executable.startsWith(`${root}${sep}`) ? executable : null
}

function runTestCommand(
  testCommand: readonly string[],
  cwd: string,
  worktreeDir: string,
  timeoutMs: number,
): string {
  const [cmd, ...args] = testCommand
  if (cmd === undefined) return ''
  const executable = replayExecutable(cmd, cwd, worktreeDir)
  if (executable === null) return ''
  try {
    const r = runCli(executable, args, { cwd, timeoutMs })
    return r.exitCode > 0 ? combineTestOutput(r.stdout, r.stderr) : ''
  } catch (err) {
    if (
      err instanceof CliError &&
      err.exitCode > 0 &&
      !err.timedOut &&
      !err.notFound &&
      !err.outputTruncated
    ) {
      return combineTestOutput(err.stdout, err.stderr)
    }
    return ''
  }
}

function removeDetachedWorktree(repoDir: string, worktreeDir: string): void {
  try {
    runCli('git', ['worktree', 'remove', '--force', worktreeDir], {
      cwd: repoDir,
      timeoutMs: 30_000,
    })
    // FAIL-OPEN-INTENT: cleanup is best-effort — the unconditional rmSync below guarantees the directory is gone regardless of this command's outcome.
  } catch {
    // no-op — see FAIL-OPEN-INTENT above
  }
  rmTranslated(worktreeDir, { recursive: true, force: true })
}
