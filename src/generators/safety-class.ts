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
 * Posix-normalized, targetDir-relative path test for a GATE-SPINE file (#2109).
 *
 * The gate entrypoint and the libraries it loads are not files that age — they
 * are the delivery vector for every check arbiter ships afterwards. Frozen by
 * `skipIfExists` the first time a project edits them, the project stops
 * receiving correctness and security fixes permanently, and the anti-erosion
 * ratchet cannot even report it: `check-all.mjs.ejs` is what wires
 * `check-safety-adopt-ratchet.mjs` into the gate, so the guard is delivered
 * through the channel the erosion blocks.
 *
 * Monotonic by directory, like the safety class: a helper added to
 * `scripts/lib/` later is covered without this pattern changing.
 *
 * Deliberately NOT `scripts/check-*.mjs`. A leaf check is exactly where a
 * governed project legitimately tunes its own thresholds, and force-adopting
 * those would overwrite intent rather than restore a fix.
 */
const GATE_SPINE_PATTERN = /^scripts\/(?:check-all\.mjs|lib\/[^/]+\.mjs)$/

/**
 * True when `key` (a manifest-style, posix-normalized, targetDir-relative
 * path — see {@link import('../state/generated-manifest.js').manifestKey})
 * names a safety-class file. Backslash paths must be normalized by the
 * caller first (the manifest/session layer already guarantees this).
 */
export function isSafetyClassKey(key: string): boolean {
  return SAFETY_CLASS_PATTERN.test(key)
}

/**
 * True when `key` names a gate-spine file (#2109). Same key contract as
 * {@link isSafetyClassKey}. Kept a separate predicate rather than widening the
 * safety one so the two adopt classes can be opted out of independently —
 * freezing a custom `check-all.mjs` must never also disarm safety-hook
 * adoption.
 */
export function isGateSpineKey(key: string): boolean {
  return GATE_SPINE_PATTERN.test(key)
}
