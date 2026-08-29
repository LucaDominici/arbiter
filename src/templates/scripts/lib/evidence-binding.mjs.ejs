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
 * FAIL-OPEN-INTENT: every unresolvable fact returns a REASON (a rejection), never
 * `null` — an unreadable git is refused, not waved through.
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

  if (branch !== undefined) {
    const current = git(root, ['rev-parse', '--abbrev-ref', 'HEAD'])
    if (current.status !== 0) return 'cannot read the current branch'
    const currentBranch = String(current.stdout).trim()
    if (currentBranch !== branch) {
      return `branch mismatch: evidence is for ${branch}, checkout is on ${currentBranch}`
    }
  }

  if (git(root, ['merge-base', '--is-ancestor', sha, 'HEAD']).status !== 0) {
    return `sha ${short(sha)} is not an ancestor of HEAD`
  }

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
 *
 * `.arbiter/agents-dispatched.json` is tracked and shared by every branch, so a
 * sidecar left behind by task X otherwise fails every other branch's gate. A
 * foreign sidecar is treated as ABSENT by the readers, not as a mismatch error.
 *
 * Conservative on both sides: a sidecar that declares no task, or an unknown
 * active task, is NOT provably foreign — voiding those would turn every legacy
 * sidecar into a silent hard failure.
 *
 * @param {unknown} sidecar parsed sidecar object
 * @param {unknown} activeTaskId task id of the current task, when known
 * @returns {boolean}
 */
export function isForeignSidecar(sidecar, activeTaskId) {
  if (typeof sidecar !== 'object' || sidecar === null) return false
  if (typeof activeTaskId !== 'string' || activeTaskId === '') return false
  const declared = [sidecar.taskId, sidecar.task].filter(
    (value) => typeof value === 'string' && value !== '',
  )
  if (declared.length === 0) return false
  return declared.every((value) => value !== activeTaskId)
}
