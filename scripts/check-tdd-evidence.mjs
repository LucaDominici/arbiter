#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// scripts/check-tdd-evidence.mjs
// L2 gate: verify TDD evidence for every task-ID commit on the current branch.
//
// Scopes to commits since git merge-base origin/main HEAD (branch-relative).
// Rejects any commit with ARBITER-SKIP-TDD: 1 trailer at L2+.
// Exits 0 if no task commits found (non-task branches pass vacuously).
// Exits 1 on any failure.
//
// Exports for unit tests: parseTaskIdsFromLog, hasSkipTrailer, formatSkipError

import { execFileSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(__dirname, '..')

// ─── Exported helpers (unit-testable) ────────────────────────────────────────

/**
 * Parse unique task IDs from git log subject lines.
 * Matches conventional-commit prefix form: type(#NNN): or type(#NNN #MMM):
 */
export function parseTaskIdsFromLog(log) {
  const seen = new Set()
  const results = []
  for (const line of log.split('\n')) {
    // Match all #NNN inside the parenthesised scope of a conventional commit subject
    // e.g. "feat(#551 #552): ..."
    const scopeMatch = line.match(/^\w+\(([^)]+)\):/)
    if (!scopeMatch) continue
    const scope = scopeMatch[1]
    for (const id of scope.matchAll(/#(\d+)/g)) {
      const full = `#${id[1]}`
      if (!seen.has(full)) {
        seen.add(full)
        results.push(full)
      }
    }
  }
  return results
}

/**
 * Returns true if the commit full message contains the ARBITER-SKIP-TDD: 1 trailer.
 */
export function hasSkipTrailer(body) {
  return /^ARBITER-SKIP-TDD: 1$/m.test(body)
}

/**
 * Format the error message for a commit carrying the skip trailer.
 */
export function formatSkipError(sha, taskId) {
  return (
    `Commit ${sha} (task ${taskId}) carries ARBITER-SKIP-TDD: 1 trailer.\n` +
    `This bypass is forbidden at L2+. Remove the trailer or record TDD evidence instead.`
  )
}

// ─── CLI entrypoint ───────────────────────────────────────────────────────────

export function makeRunner(runFn) {
  return (cmd, args, opts = {}) => runFn(cmd, args, { encoding: 'utf-8', ...opts }).trim()
}

const defaultRun = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, { encoding: 'utf-8', ...opts }).trim()

/** @param {{ runFn?: typeof defaultRun, exitFn?: (code: number) => never }} opts */
export function main({ runFn = defaultRun, exitFn = (c) => process.exit(c) } = {}) {
  const run = makeRunner(runFn)

  // ARBITER_SKIP_TDD=1 → L1-only bypass; gate still fails at L2 if trailer present
  const envSkip = process.env.ARBITER_SKIP_TDD === '1'

  let mergeBase
  try {
    mergeBase = run('git', ['merge-base', 'origin/main', 'HEAD'], { cwd: repoRoot })
  } catch {
    // If origin/main is unavailable (e.g. local-only branch), skip gracefully
    if (envSkip) {
      process.stdout.write('check-tdd-evidence: ARBITER_SKIP_TDD=1, skipping (no origin/main)\n')
      return exitFn(0)
    }
    process.stdout.write(
      'check-tdd-evidence: cannot determine merge-base (no origin/main), skipping\n',
    )
    return exitFn(0)
  }

  // Get one-liner subjects for task-ID parsing
  let subjectLog
  try {
    subjectLog = run('git', ['log', `${mergeBase}..HEAD`, '--format=%s'], { cwd: repoRoot })
  } catch {
    process.stdout.write('check-tdd-evidence: no commits since merge-base, vacuous pass\n')
    return exitFn(0)
  }

  const taskIds = parseTaskIdsFromLog(subjectLog)

  if (taskIds.length === 0) {
    process.stdout.write('check-tdd-evidence: no task-ID commits found, vacuous pass\n')
    return exitFn(0)
  }

  // Collect full commit bodies to detect skip trailers
  let bodyLog
  try {
    bodyLog = run('git', ['log', `${mergeBase}..HEAD`, '--format=%H%n%B%x00'], { cwd: repoRoot })
  } catch {
    bodyLog = ''
  }

  // Check for skip trailers — forbidden at L2+
  const commitBlocks = bodyLog.split('\x00').filter(Boolean)
  const errors = []
  for (const block of commitBlocks) {
    const lines = block.trim().split('\n')
    const sha = lines[0]?.trim()
    if (!sha || sha.length < 7) continue
    const body = lines.slice(1).join('\n')
    if (!hasSkipTrailer(body)) continue
    // Find which task IDs this commit touches
    const subject = lines[1] ?? ''
    const ids = parseTaskIdsFromLog(subject)
    const label = ids.length > 0 ? ids[0] : '<unknown>'
    errors.push(formatSkipError(sha.slice(0, 12), label))
  }

  if (errors.length > 0) {
    for (const e of errors) process.stderr.write(`\n${e}\n`)
    return exitFn(1)
  }

  if (envSkip) {
    process.stdout.write(`check-tdd-evidence: ARBITER_SKIP_TDD=1 (L1 bypass), skipping verify
`)
    return exitFn(0)
  }

  // Run arbiter verify tdd for each task ID
  // Use tsx (dev) to avoid requiring a build artifact; tsx is always available in devDeps
  const tsxBin = resolve(repoRoot, 'node_modules/.bin/tsx')
  const cliSrc = resolve(repoRoot, 'src/cli.ts')
  let anyFail = false

  for (const taskId of taskIds) {
    process.stdout.write(`  checking ${taskId}... `)
    try {
      const out = run(tsxBin, [cliSrc, 'verify', 'tdd', taskId], {
        cwd: repoRoot,
      })
      process.stdout.write('PASS\n')
      if (out) process.stdout.write(`    ${out.replace(/\n/g, '\n    ')}\n`)
    } catch (err) {
      process.stdout.write('FAIL\n')
      const msg =
        err && typeof err === 'object' && ('stderr' in err || 'stdout' in err)
          ? err.stderr || err.stdout
          : String(err)
      process.stderr.write(`    ${String(msg).replace(/\n/g, '\n    ')}\n`)
      anyFail = true
    }
  }

  if (anyFail) {
    process.stderr.write(
      `\ncheck-tdd-evidence: one or more task IDs failed TDD evidence verification.\n` +
        `Run: arbiter task record-red --test-path <path>\n`,
    )
    return exitFn(1)
  }

  process.stdout.write(`check-tdd-evidence: all ${taskIds.length} task(s) verified
`)
  return exitFn(0)
}

// Only run main when invoked as CLI (not imported in tests)
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main()
}
