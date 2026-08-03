#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// scripts/check-tdd-evidence.mjs
// L2 gate: verify TDD evidence for the change on the current branch.
//
// Scopes to commits since git merge-base origin/main HEAD (branch-relative).
// Every task id in a commit SUBJECT is verified individually. A branch with no such id
// that changes src/ must still carry at least one verified evidence among the tasks its
// commit BODIES cite (#2217) — refs-in-the-body is no longer a vacuous pass.
// Rejects any commit with ARBITER-SKIP-TDD: 1 trailer at L2+.
// Exits 1 on any failure.
//
// Usage: node scripts/check-tdd-evidence.mjs [--dir <repo>]
//   --dir points the gate at another repository (default: arbiter's own checkout).
//
// Exports for unit tests: parseTaskIdsFromLog, parseTaskIdsFromBodies,
// touchesGovernedSource, hasSkipTrailer, formatSkipError, formatFloorError,
// formatUncitedSourceError

import { execFileSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
/** Where the gate's own tooling (tsx, src/cli.ts) lives. */
const scriptRoot = resolve(__dirname, '..')

/** The repository under inspection — arbiter's own checkout unless --dir says otherwise. */
function parseDir(argv) {
  const i = argv.indexOf('--dir')
  return i !== -1 && argv[i + 1] ? resolve(argv[i + 1]) : scriptRoot
}
const repoRoot = parseDir(process.argv.slice(2))

// ─── Exported helpers (unit-testable) ────────────────────────────────────────

/**
 * Parse unique task IDs from git log subject lines.
 * Matches conventional-commit scope form: type(#NNN): or type(#NNN #MMM):,
 * and trailing subject-tail form: ... (#NNN)
 */
export function parseTaskIdsFromLog(log) {
  const seen = new Set()
  const results = []
  for (const line of log.split('\n')) {
    // Match all #NNN inside a conventional-commit scope and a trailing subject tail.
    const scopeMatch = line.match(/^\w+\(([^)]+)\):/)
    const matches = [
      ...(scopeMatch?.[1].matchAll(/#(\d+)/g) ?? []),
      ...line.matchAll(/\(#(\d+)\)$/g),
    ]
    for (const id of matches) {
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
 * Task IDs referenced in commit BODIES via a reference keyword (`Refs #NNN`,
 * `Closes #NNN`, ...) — this repo's convention for a commit carrying no TDD cycle of
 * its own. Deliberately keyword-anchored: a bare `#NNN` in prose is usually a PR or a
 * cross-reference, not a claim of authorship (#2217).
 *
 * These IDs are NOT verified per commit — that would demand TDD evidence of every docs
 * and chore commit. They are the candidate set for the branch-level floor below.
 */
export function parseTaskIdsFromBodies(bodyLog) {
  const seen = new Set()
  const results = []
  for (const m of bodyLog.matchAll(
    /\b(?:refs?|closes?|fixes?|fixed|resolves?|part of)\s+#(\d+)/gi,
  )) {
    const full = `#${m[1]}`
    if (!seen.has(full)) {
      seen.add(full)
      results.push(full)
    }
  }
  return results
}

/**
 * True when the branch changes governed source — the unit the TDD invariant is about.
 *
 * `src/templates/**` counts: templates ARE the product shipped to governed targets, so
 * exempting them would leave the hole open exactly where generated enforcement lives.
 */
export function touchesGovernedSource(changedPaths) {
  return changedPaths.split('\n').some((p) => p.trim().startsWith('src/'))
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

/** The two legitimate ways to satisfy the branch floor (#2217). */
const FLOOR_REMEDY =
  `  Two ways forward:\n` +
  `    1. record real red→green evidence for one cited task:\n` +
  `         arbiter task record-red --test-path <path>\n` +
  `    2. move the src/ change onto its own branch whose commit SUBJECT carries the\n` +
  `       task id (fix(#NNN): ...) — that commit is then verified individually.\n`

/** Branch changes src/ but cites no task at all — nothing to attach evidence to. */
export function formatUncitedSourceError() {
  return (
    `\ncheck-tdd-evidence: FAIL — this branch changes src/ but cites no task id,\n` +
    `in any commit subject or body. A source change with no traceable task cannot\n` +
    `carry TDD evidence (#2217).\n${FLOOR_REMEDY}`
  )
}

/** Branch changes src/, cites tasks in commit bodies, but no evidence verifies. */
export function formatFloorError(ids) {
  return (
    `\ncheck-tdd-evidence: FAIL — this branch changes src/ and cites ${ids.join(', ')} in\n` +
    `commit bodies, but none of them has verified TDD evidence (#2217).\n` +
    `Refs in a commit BODY are not verified per commit — otherwise every docs and chore\n` +
    `commit would owe a red→green cycle — so the branch as a whole owes one verified\n` +
    `evidence for the source it changes.\n${FLOOR_REMEDY}`
  )
}

// ─── CLI entrypoint ───────────────────────────────────────────────────────────

export function makeRunner(runFn) {
  return (cmd, args, opts = {}) => runFn(cmd, args, { encoding: 'utf-8', ...opts }).trim()
}

const defaultRun = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, { encoding: 'utf-8', ...opts }).trim()

function mergeBaseOrSkip(run, envSkip) {
  try {
    return run('git', ['merge-base', 'origin/main', 'HEAD'], { cwd: repoRoot })
  } catch {
    if (envSkip) {
      process.stdout.write('check-tdd-evidence: ARBITER_SKIP_TDD=1, skipping (no origin/main)\n')
    } else {
      process.stdout.write(
        'check-tdd-evidence: cannot determine merge-base (no origin/main), skipping\n',
      )
    }
    return null
  }
}

function subjectLogOrPass(run, mergeBase) {
  try {
    return run('git', ['log', `${mergeBase}..HEAD`, '--format=%s'], { cwd: repoRoot })
  } catch {
    process.stdout.write('check-tdd-evidence: no commits since merge-base, vacuous pass\n')
    return null
  }
}

function bodyLogOrEmpty(run, mergeBase) {
  try {
    return run('git', ['log', `${mergeBase}..HEAD`, '--format=%H%n%B%x00'], { cwd: repoRoot })
  } catch {
    return ''
  }
}

function branchFloor(run, mergeBase, taskIds, bodyLog) {
  if (taskIds.length > 0) return { exitCode: null, ids: [] }
  let changed = ''
  try {
    changed = run('git', ['diff', '--name-only', `${mergeBase}..HEAD`], { cwd: repoRoot })
  } catch {
    changed = ''
  }
  if (!touchesGovernedSource(changed)) {
    process.stdout.write(
      'check-tdd-evidence: no task-ID commits and no src/ change, vacuous pass\n',
    )
    return { exitCode: 0, ids: [] }
  }
  const ids = parseTaskIdsFromBodies(bodyLog)
  if (ids.length > 0) return { exitCode: null, ids }
  process.stderr.write(formatUncitedSourceError())
  return { exitCode: 1, ids: [] }
}

function skipTrailerErrors(bodyLog) {
  const errors = []
  for (const block of bodyLog.split('\x00').filter(Boolean)) {
    const lines = block.trim().split('\n')
    const sha = lines[0]?.trim()
    if (!sha || sha.length < 7) continue
    const body = lines.slice(1).join('\n')
    if (!hasSkipTrailer(body)) continue
    const subject = lines[1] ?? ''
    const ids = parseTaskIdsFromLog(subject)
    errors.push(formatSkipError(sha.slice(0, 12), ids.length > 0 ? ids[0] : '<unknown>'))
  }
  return errors
}

function verifyOne(run, taskId) {
  const tsxBin = resolve(scriptRoot, 'node_modules/.bin/tsx')
  const cliSrc = resolve(scriptRoot, 'src/cli.ts')
  process.stdout.write(`  checking ${taskId}... `)
  try {
    const out = run(tsxBin, [cliSrc, 'verify', 'tdd', taskId, '--dir', repoRoot], {
      cwd: repoRoot,
    })
    process.stdout.write('PASS\n')
    if (out) process.stdout.write(`    ${out.replace(/\n/g, '\n    ')}\n`)
    return true
  } catch (err) {
    process.stdout.write('FAIL\n')
    const msg =
      err && typeof err === 'object' && ('stderr' in err || 'stdout' in err)
        ? err.stderr || err.stdout
        : String(err)
    process.stderr.write(`    ${String(msg).replace(/\n/g, '\n    ')}\n`)
    return false
  }
}

function evidenceProducedHere(run, mergeBase, taskId) {
  let touched = ''
  try {
    touched = run(
      'git',
      ['log', '--format=%H', `${mergeBase}..HEAD`, '--', `.arbiter/evidence/tdd/${taskId}.json`],
      { cwd: repoRoot },
    )
  } catch {
    touched = ''
  }
  if (touched.length > 0) return true
  process.stdout.write(`  ${taskId}: evidence inherited from main, not produced on this branch\n`)
  return false
}

function verifyBranchFloor(run, mergeBase, floorIds) {
  const producedHere = floorIds.filter((taskId) => evidenceProducedHere(run, mergeBase, taskId))
  if (producedHere.some((taskId) => verifyOne(run, taskId))) {
    process.stdout.write(
      'check-tdd-evidence: branch floor satisfied (src/ change backed by verified evidence)\n',
    )
    return 0
  }
  process.stderr.write(formatFloorError(floorIds))
  return 1
}

function mainOptions(opts) {
  return {
    runFn: opts?.runFn ?? defaultRun,
    exitFn: opts?.exitFn ?? ((code) => process.exit(code)),
  }
}

/** @param {{ runFn?: typeof defaultRun, exitFn?: (code: number) => never }} opts */
export function main(opts) {
  const { runFn, exitFn } = mainOptions(opts)
  const run = makeRunner(runFn)

  // ARBITER_SKIP_TDD=1 → L1-only bypass; gate still fails at L2 if trailer present
  const envSkip = process.env.ARBITER_SKIP_TDD === '1'

  const mergeBase = mergeBaseOrSkip(run, envSkip)
  if (mergeBase === null) return exitFn(0)

  // Get one-liner subjects for task-ID parsing
  const subjectLog = subjectLogOrPass(run, mergeBase)
  if (subjectLog === null) return exitFn(0)

  const taskIds = parseTaskIdsFromLog(subjectLog)

  // Collect full commit bodies — needed for the skip-trailer check AND for the
  // branch-level floor below.
  const bodyLog = bodyLogOrEmpty(run, mergeBase)

  // #2217 — the branch floor. Subject-scoped IDs are verified per commit (below). A
  // branch whose commits cite issues only in their BODIES used to parse to zero IDs and
  // pass VACUOUSLY, whatever it changed. Evidence is now owed per CHANGE: a branch that
  // touches src/ must carry at least ONE verified TDD evidence among the tasks it cites.
  const floor = branchFloor(run, mergeBase, taskIds, bodyLog)
  if (floor.exitCode !== null) return exitFn(floor.exitCode)

  // Check for skip trailers — forbidden at L2+
  const errors = skipTrailerErrors(bodyLog)

  if (errors.length > 0) {
    for (const e of errors) process.stderr.write(`\n${e}\n`)
    return exitFn(1)
  }

  if (envSkip) {
    process.stdout.write(`check-tdd-evidence: ARBITER_SKIP_TDD=1 (L1 bypass), skipping verify
`)
    return exitFn(0)
  }

  // Floor path: the branch owes ONE verified evidence, not one per cited issue —
  // docs and chore commits that merely reference an issue owe nothing.
  if (taskIds.length === 0) {
    // ...and the evidence must have been PRODUCED here. Without this the floor is
    // theatre: cite any long-closed task whose evidence sits on main and the branch
    // "proves" a red→green cycle it never ran.
    return exitFn(verifyBranchFloor(run, mergeBase, floor.ids))
  }

  const results = taskIds.map((taskId) => verifyOne(run, taskId))
  if (results.includes(false)) {
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
