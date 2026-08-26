#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// arbiter — TDD red→green evidence re-verification gate (#1446, INV-131).
//
// On a FRESH CI checkout, re-verify that every task-ID commit on the current branch
// carries valid red→green TDD evidence — the rigor arbiter applies to itself, now
// shipped to governed targets. Self-contained: it inlines the schema + git checks so a
// target needs no local arbiter install. Scoped to commits since
// `git merge-base origin/main HEAD` (branch-relative). Rejects the ARBITER-SKIP-TDD: 1
// commit trailer (forbidden at L2+). Self-SKIPs (exit 0) when origin/main is
// unavailable (local-only branch) and for a docs-only branch without a task-ID commit
// (vacuous pass).
//
// A branch with no task id in any commit SUBJECT that changes non-documentation files must carry ONE
// verified evidence among the tasks its commit BODIES cite (`Refs #NNN`) — evidence is
// owed per CHANGE, not per commit (#2217). Independently, ANY branch changing source
// must carry one verified evidence PRODUCED on the branch, over subject ∪ body ids
// (#2307) — citing an already-merged id proves nothing, since check 4 below asserts only
// ancestry. That guard is tracked-conditional: see evidenceProducedHere().
//
// For each task #NNN it loads .arbiter/evidence/tdd/#NNN.json and asserts:
//   1. evidence file present + schema valid (v1)
//   2. evidence task_id matches the commit's task id
//   3. a recognised test-runner FAILURE signature appears in test_run_log (proves RED)
//   4. test_commit_sha (40 hex) is REACHABLE from HEAD — not merely present as an object,
//      which a pre-rebase commit behind a stale branch would be (#2116). A rebase must
//      fail here loudly; re-record the evidence. (Re-resolving a rewritten sha from the
//      RED test's blob is arbiter's own `verify tdd`, not this self-contained gate.)
//   5. test_path exists in that commit
//
// Exit codes (INV-53): 0 = all verified / vacuous · 1 = missing/inconsistent evidence
// or a forbidden skip trailer · 2 = unexpected error.
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

function parseDir(argv) {
  const i = argv.indexOf('--dir')
  return i >= 0 && argv[i + 1] ? argv[i + 1] : process.cwd()
}
const ROOT = parseDir(process.argv.slice(2))

const git = (args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf-8' }).trim()

// ─── Branch-relative task discovery ───────────────────────────────────────────
/** Unique task ids from conventional-commit scopes or trailing subject tails, e.g. "feat(#551 #552): ..." or "... (#551)". */
function parseTaskIds(subjectLog) {
  const seen = new Set()
  const ids = []
  for (const line of subjectLog.split('\n')) {
    const scope = line.match(/^\w+\(([^)]+)\):/)
    const matches = [
      ...(scope?.[1].matchAll(/#(\d+)/g) ?? []),
      ...line.matchAll(/\(#(\d+)\)$/g),
    ]
    for (const m of matches) {
      const full = `#${m[1]}`
      if (!seen.has(full)) {
        seen.add(full)
        ids.push(full)
      }
    }
  }
  return ids
}

/**
 * #2217: task ids referenced in commit BODIES (`Refs #NNN`, `Closes #NNN`, ...) — the
 * convention for a commit with no TDD cycle of its own. Keyword-anchored so a bare
 * `#NNN` in prose (a PR, a cross-reference) is not mistaken for authorship. These are
 * NOT verified per commit; they are the candidate set for the branch floor.
 */
function parseBodyTaskIds(bodyLog) {
  const seen = new Set()
  const ids = []
  for (const m of bodyLog.matchAll(/\b(?:refs?|closes?|fixes?|fixed|resolves?|part of)\s+#(\d+)/gi)) {
    const full = `#${m[1]}`
    if (!seen.has(full)) {
      seen.add(full)
      ids.push(full)
    }
  }
  return ids
}

/**
 * True only when every changed path is a documentation artifact. This is deliberately
 * an allowlist: executable files in flat, cmd/, internal/, pkg/, nested-module, or gate-
 * script layouts must never become vacuous merely because their path lacks `src/`.
 */
function isDocsOnlyChange(changedPaths) {
  const paths = changedPaths.split('\n').map((p) => p.trim()).filter(Boolean)
  const doc = /\.(?:md|mdx|rst|adoc|txt)$/i
  const docAsset = /\.(?:png|jpe?g|gif|webp|svg)$/i
  return paths.length > 0 && paths.every((p) => {
    if (!p.includes('/')) return p !== 'AGENTS.md' && doc.test(p)
    return /^(?:docs|wiki)\//.test(p) && (doc.test(p) || docAsset.test(p))
  })
}

/** The two legitimate ways to satisfy the branch floor (#2217). */
const FLOOR_REMEDY =
  '  Two ways forward:\n' +
  '    1. record real red→green evidence for one cited task:\n' +
  '         arbiter task record-red --test-path <path>\n' +
  '    2. move the source change onto its own branch whose commit SUBJECT carries the\n' +
  '       task id (fix(#NNN): ...) — that commit is then verified individually.\n'

const hasSkipTrailer = (body) => /^ARBITER-SKIP-TDD: 1$/m.test(body)

// ─── Evidence verification (inlined — no arbiter CLI dependency) ───────────────
const FAILURE_SIGNATURES = [
  /FAIL\s+\S+\.test\.[jt]sx?/m, // vitest
  /FAIL\s+\S+\.(spec|test)\.[jt]sx?/m, // jest
  /\d+ scenarios? \(\d+ failed/m, // cucumber
  /={3,}\s*FAILURES\s*={3,}/m, // pytest
  /FAILED\s*$|BUILD FAILED/m, // gradle
  /test result: FAILED/m, // cargo
  /--- FAIL:/m, // go
  /^# fail [1-9]\d*/m, // tap (node:test)
]
const hasFailureSignature = (log) => FAILURE_SIGNATURES.some((re) => re.test(log))

/** Plain-JS mirror of the TddEvidenceV1 schema — returns { ok, reason }. */
function validateSchema(ev) {
  if (!ev || typeof ev !== 'object') return { ok: false, reason: 'evidence is not an object' }
  if (ev.$schemaVersion !== 1) return { ok: false, reason: '$schemaVersion must be 1' }
  if (typeof ev.task_id !== 'string' || !/^#\d+$/.test(ev.task_id))
    return { ok: false, reason: 'task_id must match /^#\\d+$/' }
  if (typeof ev.test_path !== 'string' || ev.test_path.length === 0)
    return { ok: false, reason: 'test_path must be a non-empty string' }
  if (typeof ev.test_commit_sha !== 'string' || !/^[0-9a-f]{40}$/i.test(ev.test_commit_sha))
    return { ok: false, reason: 'test_commit_sha must be 40 hex characters' }
  if (typeof ev.test_run_log !== 'string')
    return { ok: false, reason: 'test_run_log must be a string' }
  if (typeof ev.observed_failure !== 'string' || ev.observed_failure.length === 0)
    return { ok: false, reason: 'observed_failure must not be empty' }
  if (typeof ev.recorded_at !== 'string' || Number.isNaN(Date.parse(ev.recorded_at)))
    return { ok: false, reason: 'recorded_at must be an ISO8601 datetime' }
  return { ok: true }
}

/**
 * #2116: REACHABILITY, not object existence. `cat-file -e` passes for any object still
 * present in the repo — including the pre-rebase commit of a branch that was rebased
 * before merging, whose evidence then "verifies" against history nobody can reach, and
 * turns unverifiable the day the stale branch is deleted. A rebase must fail loudly here
 * (re-record the evidence) instead of silently passing.
 */
function shaExists(sha) {
  try {
    git(['merge-base', '--is-ancestor', sha, 'HEAD'])
    return true
  } catch {
    return false
  }
}
function pathInCommit(sha, path) {
  try {
    return git(['ls-tree', '--name-only', sha, path]).length > 0
  } catch {
    return false
  }
}

/** Run the 5 checks for one task id — returns { ok, reason }. */
function verifyTask(taskId) {
  const p = join(ROOT, '.arbiter', 'evidence', 'tdd', `${taskId}.json`)
  if (!existsSync(p)) return { ok: false, reason: `evidence not found at ${p}` }
  let ev
  try {
    ev = JSON.parse(readFileSync(p, 'utf-8'))
  } catch (err) {
    return { ok: false, reason: `invalid JSON in evidence: ${err.message}` }
  }
  const schema = validateSchema(ev)
  if (!schema.ok) return { ok: false, reason: `schema: ${schema.reason}` }
  if (ev.task_id !== taskId)
    return { ok: false, reason: `task_id mismatch: evidence has "${ev.task_id}"` }
  if (!hasFailureSignature(ev.test_run_log))
    return { ok: false, reason: 'no recognised failure signature in test_run_log (no RED proof)' }
  if (!shaExists(ev.test_commit_sha))
    return { ok: false, reason: `test_commit_sha ${ev.test_commit_sha} not in git history` }
  if (!pathInCommit(ev.test_commit_sha, ev.test_path))
    return { ok: false, reason: `test_path "${ev.test_path}" not in commit ${ev.test_commit_sha}` }
  return { ok: true }
}

/**
 * #2307: was this task's evidence PRODUCED on this branch, or merely INHERITED from
 * main? Check 4 above asserts only that test_commit_sha is an ANCESTOR of HEAD — once a
 * task's evidence is merged to main, every later branch satisfies it. Citing an
 * already-merged id would otherwise "prove" a red→green cycle the branch never ran.
 *
 * Returns true/false when the evidence file is TRACKED, and null when it is not. The
 * generated .gitignore now carves `.arbiter/evidence/tdd/*.json` out of the `.arbiter/**`
 * blanket (#2313), so a target that records evidence can commit it and this guard binds.
 * It stays tracked-CONDITIONAL on purpose: `skipIfExists` never rewrites an existing
 * .gitignore, so a consumer initialized before #2313 still has the blanket rule, and an
 * unconditional guard would redden every one of its branches — blindness traded for a
 * false red. The WARNING below names the one-line fix.
 */
function evidenceProducedHere(mergeBase, taskId) {
  const path = `.arbiter/evidence/tdd/${taskId}.json`
  let tracked = ''
  try {
    tracked = git(['ls-files', '--', path])
  } catch {
    tracked = ''
  }
  if (tracked.length === 0) return null
  try {
    return git(['log', '--format=%H', `${mergeBase}..HEAD`, '--', path]).length > 0
  } catch {
    return false
  }
}

/**
 * The branch floor: does SOME candidate carry evidence that verifies AND was not merely
 * inherited from main? One verified evidence is owed per CHANGE, not one per cited issue.
 */
function floorSatisfied(mergeBase, candidates) {
  for (const taskId of candidates) {
    const fresh = evidenceProducedHere(mergeBase, taskId)
    if (fresh === false) {
      process.stdout.write(
        `  ${taskId}: evidence inherited from main, not produced on this branch\n`,
      )
      continue
    }
    if (fresh === null) {
      process.stdout.write(
        `  ${taskId}: WARNING — evidence file is untracked, so the produced-here guard ` +
          `(#2307) cannot apply. Un-ignore .arbiter/evidence/tdd/*.json to make it live.\n`,
      )
    }
    const r = verifyTask(taskId)
    process.stdout.write(`  ${taskId}: ${r.ok ? 'PASS' : `FAIL — ${r.reason}`}\n`)
    if (r.ok) return true
  }
  return false
}

// ─── Entry point ──────────────────────────────────────────────────────────────
function run() {
let mergeBase
try {
  mergeBase = git(['merge-base', 'origin/main', 'HEAD'])
} catch {
  process.stdout.write('check-tdd-evidence: no origin/main (local-only branch), skipping\n')
  process.exit(0)
}

let subjectLog
try {
  subjectLog = git(['log', `${mergeBase}..HEAD`, '--format=%s'])
} catch {
  throw new Error('cannot read branch commit subjects')
}
if (subjectLog.length === 0) {
  process.stdout.write('check-tdd-evidence: no commits since merge-base, vacuous pass\n')
  process.exit(0)
}

const taskIds = parseTaskIds(subjectLog)

let bodyLog = ''
try {
  bodyLog = git(['log', `${mergeBase}..HEAD`, '--format=%H%n%B%x00'])
} catch {
  throw new Error('cannot read branch commit bodies')
}

// #2217 — the branch floor. Subject-scoped ids are verified per commit (below). A branch
// whose commits cite issues only in their BODIES (`Refs #NNN`, the convention for a
// commit with no TDD cycle of its own) parsed to zero ids and passed VACUOUSLY, whatever
// it changed. Evidence is owed per CHANGE: a branch that touches source must carry at
// least ONE verified evidence among the tasks it cites.
let changed
try {
  changed = git(['diff', '--name-only', `${mergeBase}..HEAD`])
} catch {
  throw new Error('cannot determine changed files')
}
if (changed.trim().length === 0) throw new Error('changed-file probe returned no usable paths')
// Computed on BOTH paths: the subject path owes the produced-here floor too (#2307),
// and it is gated on this exact predicate.
const docsOnly = isDocsOnlyChange(changed)

// Candidates are subject ids UNION body ids: a merge-train branch whose subject cites a
// merged id but whose body cites a task with fresh on-branch evidence has run a real
// cycle and must pass.
const floorIds = [...new Set([...taskIds, ...parseBodyTaskIds(bodyLog)])]

if (taskIds.length === 0) {
  if (docsOnly) {
    process.stdout.write('check-tdd-evidence: no task-ID commits and docs-only change, vacuous pass\n')
    process.exit(0)
  }
  if (floorIds.length === 0) {
    process.stderr.write(
      '\ncheck-tdd-evidence: FAIL — this branch changes non-documentation files but cites no task id in any ' +
        'commit subject or body, so no TDD evidence can back it (#2217).\n' + FLOOR_REMEDY,
    )
    process.exit(1)
  }
}

// Reject the skip trailer — forbidden at L2+.
for (const block of bodyLog.split('\x00').filter(Boolean)) {
  const lines = block.trim().split('\n')
  const sha = lines[0]?.trim()
  if (!sha || sha.length < 7) continue
  if (!hasSkipTrailer(lines.slice(1).join('\n'))) continue
  const ids = parseTaskIds(lines[1] ?? '')
  process.stderr.write(
    `\ncheck-tdd-evidence: FAIL — commit ${sha.slice(0, 12)} (task ${ids[0] ?? '<unknown>'}) ` +
      'carries ARBITER-SKIP-TDD: 1, forbidden at L2+. Remove it or record TDD evidence.\n',
  )
  process.exit(1)
}

// #2371: a task id in a docs-only commit does not owe TDD evidence. The source-change
// classifier above is authoritative; subject ids only select evidence for a
// non-documentation change.
if (docsOnly) {
  process.stdout.write('check-tdd-evidence: docs-only change, vacuous pass\n')
  process.exit(0)
}

// Floor path: the branch owes ONE verified evidence, not one per cited issue — a docs
// or chore commit that merely references an issue owes nothing.
if (taskIds.length === 0) {
  if (floorSatisfied(mergeBase, floorIds)) {
    process.stdout.write('check-tdd-evidence: OK — branch floor satisfied (#2217)\n')
    process.exit(0)
  }
  process.stderr.write(
    `\ncheck-tdd-evidence: FAIL — this branch changes non-documentation files and cites ${floorIds.join(', ')}, but ` +
      'none of them has verified TDD evidence produced on this branch (#2217, #2307).\n' +
      FLOOR_REMEDY,
  )
  process.exit(1)
}

let anyFail = false
for (const taskId of taskIds) {
  const r = verifyTask(taskId)
  if (r.ok) {
    process.stdout.write(`  ${taskId}: PASS\n`)
  } else {
    process.stdout.write(`  ${taskId}: FAIL — ${r.reason}\n`)
    anyFail = true
  }
}

if (anyFail) {
  process.stderr.write(
    '\ncheck-tdd-evidence: one or more task(s) failed TDD evidence re-verification. ' +
      'Record red→green evidence with `arbiter task record-red --test-path <path>`.\n',
  )
  process.exit(1)
}
// #2307 — the SAME produced-here floor, on the subject path. The per-id loop above
// proves each cited task HAS evidence; it cannot prove this branch PRODUCED any of it,
// because check 4 asserts only ancestry. So a branch touching source whose subject cites
// an already-merged id passed the floor with no red→green cycle at all. The docs-only
// return above keeps a documentation branch that happens to cite a task id green.
if (!floorSatisfied(mergeBase, floorIds)) {
  process.stderr.write(
    `\ncheck-tdd-evidence: FAIL — this branch changes non-documentation files and cites ${floorIds.join(', ')}, but ` +
      'none of them has verified TDD evidence produced on this branch (#2307).\n' + FLOOR_REMEDY,
  )
  process.exit(1)
}

process.stdout.write(`check-tdd-evidence: OK — ${taskIds.length} task(s) verified\n`)
process.exit(0)
}

try {
  run()
} catch (err) {
  // Unexpected internal error (e.g. an evidence file unreadable for reasons other than
  // absence/parse) → exit 2 per INV-53, never a silent pass.
  process.stderr.write(`check-tdd-evidence: unexpected error: ${err && err.message}\n`)
  process.exit(2)
}
