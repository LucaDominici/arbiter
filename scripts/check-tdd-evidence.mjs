#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// scripts/check-tdd-evidence.mjs
// L2 gate: verify TDD evidence for the change on the current branch.
//
// Scopes to commits since git merge-base origin/main HEAD (branch-relative).
// Every task id in a commit SUBJECT is verified individually. A branch with no such id
// that changes non-documentation files must still carry at least one verified evidence among the tasks its
// commit BODIES cite (#2217) — refs-in-the-body is no longer a vacuous pass.
// Independently, ANY branch changing non-documentation files must carry one verified evidence PRODUCED on
// the branch, over subject ∪ body ids (#2307) — citing an already-merged id proves
// nothing, since verify tdd's sha-on-branch check asserts only ancestry.
// Rejects any commit with ARBITER-SKIP-TDD: 1 trailer at L2+.
// Exits 1 on any failure.
//
// Usage: node scripts/check-tdd-evidence.mjs [--dir <repo>]
//   --dir points the gate at another repository (default: arbiter's own checkout).
//
// Exports for unit tests: parseTaskIdsFromLog, parseTaskIdsFromBodies,
// isDocsOnlyChange, hasSkipTrailer, formatSkipError, formatFloorError,
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
 * True only when every changed path is a documentation artifact. This is deliberately
 * an allowlist: executable files in flat, cmd/, internal/, pkg/, nested-module, or gate-
 * script layouts must never become vacuous merely because their path lacks `src/`.
 */
export function isDocsOnlyChange(changedPaths) {
  const paths = changedPaths
    .split('\n')
    .map((p) => p.trim())
    .filter(Boolean)
  const doc = /\.(?:md|mdx|rst|adoc|txt)$/i
  const docAsset = /\.(?:png|jpe?g|gif|webp|svg)$/i
  return (
    paths.length > 0 &&
    paths.every((p) => {
      if (!p.includes('/')) return p !== 'AGENTS.md' && doc.test(p)
      return /^(?:docs|wiki)\//.test(p) && (doc.test(p) || docAsset.test(p))
    })
  )
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
  `    2. move the non-documentation change onto its own branch whose commit SUBJECT carries the\n` +
  `       task id (fix(#NNN): ...) — that commit is then verified individually.\n`

/** Branch changes non-documentation files but cites no task — nothing to attach evidence to. */
export function formatUncitedSourceError() {
  return (
    `\ncheck-tdd-evidence: FAIL — this branch changes non-documentation files but cites no task id,\n` +
    `in any commit subject or body. A governed change with no traceable task cannot\n` +
    `carry TDD evidence (#2217).\n${FLOOR_REMEDY}`
  )
}

/**
 * Branch changes non-documentation files and cites tasks, but none has evidence PRODUCED on
 * this branch and verifies. Fires on either citation path (#2217, #2307).
 */
export function formatFloorError(ids, subjectCited = false) {
  // Remedy 2 tells you to put the task id in a commit SUBJECT. On the subject path it is
  // already there, so offering it would be a no-op instruction on the very failure it
  // answers — only the fresh-evidence remedy applies.
  const remedy = subjectCited
    ? `  Record real red→green evidence for one cited task:\n` +
      `    arbiter task record-red --test-path <path>\n`
    : FLOOR_REMEDY
  return (
    `\ncheck-tdd-evidence: FAIL — this branch changes non-documentation files and cites ${ids.join(', ')},\n` +
    `but none of them has verified TDD evidence PRODUCED on this branch (#2217, #2307).\n` +
    `Citing a task whose evidence already sits on main proves nothing: verify tdd's\n` +
    `sha-on-branch check asserts only ancestry, which every branch off main satisfies.\n` +
    `The branch as a whole owes one fresh red→green cycle for the source it changes.\n` +
    `${remedy}`
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
    process.stderr.write('check-tdd-evidence: ERROR — cannot read branch commit subjects\n')
    return null
  }
}

function bodyLogOrEmpty(run, mergeBase) {
  try {
    return run('git', ['log', `${mergeBase}..HEAD`, '--format=%H%n%B%x00'], { cwd: repoRoot })
  } catch {
    process.stderr.write('check-tdd-evidence: ERROR — cannot read branch commit bodies\n')
    return null
  }
}

function branchFloor(run, mergeBase, taskIds, bodyLog) {
  let changed
  try {
    changed = run('git', ['diff', '--name-only', `${mergeBase}..HEAD`], { cwd: repoRoot })
  } catch {
    process.stderr.write('check-tdd-evidence: ERROR — cannot determine changed files\n')
    return { exitCode: 2, docsOnly: false }
  }
  if (changed.trim().length === 0) {
    process.stderr.write(
      'check-tdd-evidence: ERROR — changed-file probe returned no usable paths\n',
    )
    return { exitCode: 2, docsOnly: false }
  }
  // Computed on BOTH paths: the subject path owes the produced-here floor too (#2307),
  // and it is gated on this exact predicate.
  const docsOnly = isDocsOnlyChange(changed)
  if (taskIds.length > 0) return { exitCode: null, docsOnly }
  if (docsOnly) {
    process.stdout.write(
      'check-tdd-evidence: no task-ID commits and docs-only change, vacuous pass\n',
    )
    return { exitCode: 0, docsOnly }
  }
  const ids = parseTaskIdsFromBodies(bodyLog)
  if (ids.length > 0) return { exitCode: null, docsOnly }
  process.stderr.write(formatUncitedSourceError())
  return { exitCode: 1, docsOnly }
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

function verifyBranchFloor(run, mergeBase, floorIds, subjectCited = false) {
  const producedHere = floorIds.filter((taskId) => evidenceProducedHere(run, mergeBase, taskId))
  if (producedHere.some((taskId) => verifyOne(run, taskId))) {
    process.stdout.write(
      'check-tdd-evidence: branch floor satisfied (src/ change backed by verified evidence)\n',
    )
    return 0
  }
  process.stderr.write(formatFloorError(floorIds, subjectCited))
  return 1
}

/**
 * #2307 — the produced-here floor on the SUBJECT path. Per-id verification proves each
 * cited task HAS evidence; it cannot prove this branch PRODUCED any of it, because
 * verify tdd's sha-on-branch check asserts only ANCESTRY. So a branch touching src/
 * whose subject cites an already-merged id passed the floor with no red→green cycle at
 * all. The docs-only return above keeps a documentation branch that happens to cite a
 * task id in its subject green.
 *
 * Extracted from main() to keep it inside the complexity-10 ratchet (#1523/#1542).
 */
function subjectFloorFails(run, mergeBase, floorIds) {
  return verifyBranchFloor(run, mergeBase, floorIds, true) !== 0
}

function collectBranchContext(run, envSkip) {
  const mergeBase = mergeBaseOrSkip(run, envSkip)
  if (mergeBase === null) return { exitCode: 0 }
  const subjectLog = subjectLogOrPass(run, mergeBase)
  if (subjectLog === null) return { exitCode: 2 }
  if (subjectLog.length === 0) {
    process.stdout.write('check-tdd-evidence: no commits since merge-base, vacuous pass\n')
    return { exitCode: 0 }
  }
  const taskIds = parseTaskIdsFromLog(subjectLog)
  const bodyLog = bodyLogOrEmpty(run, mergeBase)
  if (bodyLog === null) return { exitCode: 2 }
  const floor = branchFloor(run, mergeBase, taskIds, bodyLog)
  if (floor.exitCode !== null) return { exitCode: floor.exitCode }
  return { mergeBase, taskIds, bodyLog, floor }
}

function verifySubjectTasks(run, taskIds) {
  if (!taskIds.map((taskId) => verifyOne(run, taskId)).includes(false)) return true
  process.stderr.write(
    `\ncheck-tdd-evidence: one or more task IDs failed TDD evidence verification.\n` +
      `Run: arbiter task record-red --test-path <path>\n`,
  )
  return false
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
  const context = collectBranchContext(run, envSkip)
  if ('exitCode' in context) return exitFn(context.exitCode)
  const { mergeBase, taskIds, bodyLog, floor } = context

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

  // #2371: subject ids do not create a TDD obligation by themselves. Once the
  // branch-floor predicate has established that only documentation changed,
  // docs-only work remains a vacuous pass.
  if (floor.docsOnly) {
    process.stdout.write('check-tdd-evidence: docs-only change, vacuous pass\n')
    return exitFn(0)
  }

  // The branch owes ONE verified evidence, not one per cited issue — docs and chore
  // commits that merely reference an issue owe nothing. Candidates are subject ids UNION
  // body ids: a merge-train branch whose subject cites a merged id but whose body cites
  // a task with fresh on-branch evidence has run a real cycle and must pass.
  const floorIds = [...new Set([...taskIds, ...parseTaskIdsFromBodies(bodyLog)])]

  // Floor path: no subject id at all — the evidence must have been PRODUCED here.
  // Without this the floor is theatre: cite any long-closed task whose evidence sits on
  // main and the branch "proves" a red→green cycle it never ran.
  if (taskIds.length === 0) {
    return exitFn(verifyBranchFloor(run, mergeBase, floorIds))
  }

  if (!verifySubjectTasks(run, taskIds)) return exitFn(1)

  if (subjectFloorFails(run, mergeBase, floorIds)) {
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
