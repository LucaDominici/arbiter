// SPDX-License-Identifier: Apache-2.0
/**
 * Safety-class manifest (T1, convergence playbook §T1).
 *
 * A "safety-class" file is an emitted artifact whose whole purpose is to STOP
 * an agent from doing something dangerous or from fabricating a completion
 * claim (the J1 completion-integrity kernel + the dangerous-command/read-only/
 * SSOT guards it ships alongside). Every file arbiter emits under
 * `.claude/hooks/*.mjs` is safety-class by construction — none of them are
 * cosmetic, and a new hook added later is automatically covered without this
 * list needing an update (monotonic-by-directory, not by enumeration).
 *
 * Why this matters: `update`'s existing `skipIfExists` contract freezes a
 * user-modified file forever — correct default for most templates, but for a
 * safety hook it is exactly how governance erodes in silence (a `stop-
 * dangerous.mjs` fix ships, a target repo's user-modified copy never receives
 * it, and nobody is told). This module is the single predicate both
 * `update --adopt-safety` (the write-time anti-erosion default) and
 * `check-safety-adopt-ratchet.mjs` (the read-time ratchet gate) consult, so
 * the two can never independently drift on the definition of "safety-class".
 */

/** Posix-normalized, targetDir-relative path test for a safety-class file. */
const SAFETY_CLASS_PATTERN = /^\.claude\/hooks\/[^/]+\.mjs$/

/**
 * True when `key` (a manifest-style, posix-normalized, targetDir-relative
 * path — see {@link import('../state/generated-manifest.js').manifestKey})
 * names a safety-class file. Backslash paths must be normalized by the
 * caller first (the manifest/session layer already guarantees this).
 */
export function isSafetyClassKey(key: string): boolean {
  return SAFETY_CLASS_PATTERN.test(key)
}
