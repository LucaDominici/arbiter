#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
//
// #2399 — content binding for review/dispatch evidence.
//
// Binding review evidence to `sha === HEAD` makes every evidence-refresh commit
// invalidate the evidence it just recorded: writing the artifact moves HEAD, so
// the artifact must be rewritten and re-committed, forever (one PR carried nine
// pure sha-bump commits). The property the evidence actually claims is "an agent
// reviewed THIS SOURCE", so the binding is to source content:
//
//   valid iff  sha resolves
//         AND  sha is an ancestor of HEAD          (same history, not a fork)
//         AND  no path outside the evidence dirs changed between sha and HEAD
//         AND  (when required) the checkout is on the branch the evidence names.
//
// Scope is deliberately the COMMITTED range only. Working-tree, index and
// untracked dirt are NOT inspected here — every consumer keeps its own
// dirty-checkout guard, so an uncommitted `src/` edit still invalidates the
// evidence. Folding dirt in here would let a consumer drop its guard and end up
// weaker than the exact-HEAD rule this replaces.
//
// The gate-pass marker (`.arbiter/gate-pass.json`, scripts/lib/gate-evidence.mjs)
// deliberately stays EXACT-HEAD: the gate regenerates it on every run and it is
// TTL-bound, so it has no refresh-loop problem to solve.
//
// Consumed by scripts/check-cross-model-review.mjs, scripts/check-review-completion.mjs,
// scripts/check-agent-return.mjs and .claude/hooks/stop-evidence-guard.mjs.
import { spawnSync } from 'node:child_process'
import { existsSync, lstatSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/** Paths that hold evidence itself — a commit touching only these is not a source change. */
const DEFAULT_EXCLUDES = Object.freeze(['.arbiter', '.agents'])

function short(sha) {
  return String(sha).slice(0, 7)
}

function git(root, args) {
  return spawnSync('git', args, {
    cwd: root,
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'ignore'],
  })
}

/**
 * Why `sha` no longer describes the current checkout, or `null` when it still does.
 *
 * FAIL-CLOSED: every unresolvable fact returns a REASON (a rejection), never `null` —
 * an unreadable git is refused, not waved through.
 *
 * @param {string} root repository root
 * @param {unknown} sha commit the evidence was recorded at
 * @param {{ branch?: string, excludes?: readonly string[] }} [opts]
 * @returns {string | null} a specific reason, or null when the evidence still binds
 */
export function evidenceStaleness(root, sha, opts = {}) {
  const { branch, excludes = DEFAULT_EXCLUDES } = opts
  if (typeof sha !== 'string' || sha.trim() === '') return 'evidence records no sha'

  if (git(root, ['rev-parse', '--verify', '--quiet', `${sha}^{commit}`]).status !== 0) {
    return `sha ${short(sha)} does not resolve in this repository`
  }

  const mismatch = branchMismatch(root, branch)
  if (mismatch !== null) return mismatch

  if (git(root, ['merge-base', '--is-ancestor', sha, 'HEAD']).status !== 0) {
    return `sha ${short(sha)} is not an ancestor of HEAD`
  }

  return sourceChange(root, sha, excludes)
}

/**
 * Why the checkout is not on the branch the evidence names, or null when it is (or when the
 * evidence names none). An unreadable branch is a REASON, never a pass.
 *
 * @param {string} root repository root
 * @param {string | undefined} branch branch the evidence was recorded on
 * @returns {string | null}
 */
function branchMismatch(root, branch) {
  if (branch === undefined) return null
  const current = git(root, ['rev-parse', '--abbrev-ref', 'HEAD'])
  if (current.status !== 0) return 'cannot read the current branch'
  const currentBranch = String(current.stdout).trim()
  if (currentBranch === branch) return null
  return `branch mismatch: evidence is for ${branch}, checkout is on ${currentBranch}`
}

/**
 * Why the committed tree outside `excludes` differs between `sha` and HEAD, or null when it
 * does not. An unreadable diff is a REASON, never a pass.
 *
 * @param {string} root repository root
 * @param {string} sha commit the evidence was recorded at
 * @param {readonly string[]} excludes paths that hold evidence itself
 * @returns {string | null}
 */
function sourceChange(root, sha, excludes) {
  // `git diff --quiet` is a trichotomy: 0 unchanged, 1 changed, >=2 error.
  const diff = git(root, [
    'diff',
    '--quiet',
    sha,
    'HEAD',
    '--',
    '.',
    ...excludes.map((path) => `:(exclude)${path}`),
  ])
  if (diff.status === 1) return `source changed since ${short(sha)}`
  if (diff.status !== 0) return `cannot compare the tree against ${short(sha)}`
  return null
}

/**
 * True when a dispatch sidecar was recorded for a DIFFERENT task than the active one.
 * A foreign sidecar is treated as ABSENT by the readers, not as a mismatch error.
 *
 * An unknown active task is NOT provably foreign. A sidecar that declares no task is
 * foreign only when `strict` — the legacy shared file (#2912), which counts for a task
 * only when it names exactly that task.
 *
 * @param {unknown} sidecar parsed sidecar object
 * @param {unknown} activeTaskId task id of the current task, when known
 * @param {boolean} [strict] treat a sidecar that declares no task as foreign
 * @returns {boolean}
 */
export function isForeignSidecar(sidecar, activeTaskId, strict = false) {
  if (typeof sidecar !== 'object' || sidecar === null) return strict
  if (typeof activeTaskId !== 'string' || activeTaskId === '') return false
  const declared = [sidecar.taskId, sidecar.task].filter(
    (value) => typeof value === 'string' && value !== '',
  )
  if (declared.length === 0) return strict
  return declared.every((value) => value !== activeTaskId)
}

/** #2912 — the review-dispatch sidecar is one file per task under this directory. */
export const DISPATCH_SIDECAR_DIR = Object.freeze(['.arbiter', 'agents-dispatched'])
/** The pre-#2912 single file shared by every branch: read on an exact task match, never written. */
export const LEGACY_DISPATCH_SIDECAR = join('.arbiter', 'agents-dispatched.json')

/**
 * Same rule as `sanitizeTaskId` (src/utils/task-id.ts, scripts/lib/gate-evidence.mjs), kept
 * local so this library stays import-free for consumers that ship it alone.
 * @param {string} taskId
 * @returns {string} the task's sidecar file name, e.g. `_2912.json`
 */
export function dispatchSidecarName(taskId) {
  const cleaned = String(taskId)
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .slice(0, 64)
  return `${cleaned.length > 0 ? cleaned : 'unknown'}.json`
}

/** @param {string} root @param {string} taskId @returns {string} */
export function dispatchSidecarPath(root, taskId) {
  return join(root, ...DISPATCH_SIDECAR_DIR, dispatchSidecarName(taskId))
}

function branchSidecars(root, branch) {
  const dir = join(root, ...DISPATCH_SIDECAR_DIR)
  if (branch === null || !existsSync(dir)) return []
  return readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .map((name) => join(dir, name))
    .filter((path) => sidecarBranch(path) === branch)
}

function sidecarBranch(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf-8'))?.branch
    // FAIL-OPEN-INTENT: an unreadable, malformed or directory entry names no branch, so another
    // task's bad file cannot break this branch's scan; a known task reads its own file directly.
  } catch {
    return undefined
  }
}

/**
 * The dispatch sidecar this checkout's readers consult (#2912).
 *
 * Known task: its own per-task file, else the legacy file (`legacy: true`, which readers
 * judge with `isForeignSidecar(…, strict)`). Unknown task (CI runs without `--task` or
 * task state): the per-task file recorded on the current branch; none → the legacy file
 * under the readers' existing branch check; more than one → an error, never a guess.
 *
 * @param {string} root repository root
 * @param {unknown} task active task id, when known
 * @returns {{ path: string, legacy: boolean } | { error: string }}
 */
export function locateDispatchSidecar(root, task) {
  const legacy = { path: join(root, LEGACY_DISPATCH_SIDECAR), legacy: true }
  if (typeof task === 'string' && task !== '') {
    const own = dispatchSidecarPath(root, task)
    // lstat, not exists: a dangling symlink is the task's file, refused by the reader.
    return lstatSync(own, { throwIfNoEntry: false }) ? { path: own, legacy: false } : legacy
  }
  const head = git(root, ['rev-parse', '--abbrev-ref', 'HEAD'])
  const branch = head.status === 0 ? String(head.stdout).trim() : null
  let matches
  try {
    matches = branchSidecars(root, branch)
  } catch (err) {
    return { error: `cannot scan dispatch sidecars: ${err instanceof Error ? err.message : err}` }
  }
  if (matches.length > 1) {
    return {
      error: `${matches.length} dispatch sidecars name branch ${branch}: ${matches.join(', ')}`,
    }
  }
  return matches.length === 1 ? { path: matches[0], legacy: false } : legacy
}
