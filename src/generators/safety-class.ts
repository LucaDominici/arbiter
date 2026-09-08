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
 * The gate entrypoint and the libraries it loads are the delivery vector for
 * every check arbiter ships afterwards; frozen, a project stops receiving them.
 * #2109 concluded from that they should be force-adopted by default. #2119
 * reversed the conclusion, not the observation: adoption is only safe when the
 * template render is a SUPERSET of the local file. That holds for
 * `.claude/hooks/*.mjs` (whole files arbiter owns); it does not hold for
 * `scripts/check-all.mjs`, which is by construction the point where a project
 * wires its OWN checks — customization *is* its function. Measured on a copy of
 * a real governed consumer, a bare `arbiter update` deleted 25 project checks,
 * 12 of them security, and the gate stayed green because the checks did not
 * fail, they vanished. So the spine is WITHHELD by default and adopted only
 * under an explicit `--adopt-gate-spine`.
 *
 * The class itself survives the reversal and is still needed: it selects what
 * `--adopt-gate-spine` opts into, what `localOverrideReason` explains, and what
 * `withheldSafetyKeys` keeps reporting so the withheld-spine debt (the checks
 * arbiter ships that the project has not wired) can never go silent.
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
 * Posix-normalized, targetDir-relative path test for a GOVERNANCE-class file (#2120).
 *
 * These two files are re-rendered on EVERY selective update on purpose
 * (`update.ts` adds the `agents-md` and `claude` generator keys to any
 * selective run, #2056): `AGENTS.md` carries the Iron Laws and
 * `.claude/settings.json` carries the `ARBITER_*` deny list, and both render
 * from the whole config plus their templates, so either can carry updated
 * governance content independent of which config field changed. Leaving them
 * stale is the root cause behind the #2040 downstream-consumer drift.
 *
 * #2120 gave every always-rewrite file a provenance test, which would have
 * frozen exactly these two for anybody who touched them — re-opening #2040
 * through the back door. #2141 applies #2119's superset principle: the class
 * survives, but its default reverses. A pristine file still re-renders through
 * #2056; a diverged one is WITHHELD unless explicitly force-adopted with
 * `--adopt-governance`, because the template render is not a superset of the
 * governed consumer's content. That opt-in remains visible and reversible via
 * `.arbiter/evidence/local-overrides/`.
 *
 * Deliberately exactly two entries, not a directory pattern: the class is
 * bounded by what #2056 force-renders, so it cannot quietly grow to mean "any
 * file that looks governance-ish". A project that genuinely wants one frozen
 * marks it with `arbiter:preserve` (checked ahead of every adopt policy), which
 * works in JSON as an ordinary key.
 *
 * Exported (#2447) so `docs/REFERENCE/file-stability.md`'s File Map can be
 * pinned against the SAME set the generators consult, rather than a
 * hand-copied literal that could independently drift from the code — see
 * `__tests__/docs/file-stability-truth-2447.test.ts`.
 */
export const GOVERNANCE_CLASS_KEYS = new Set(['AGENTS.md', '.claude/settings.json'])

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
 * True when `key` names a gate-spine file (#2109, semantics reversed by #2119).
 * Same key contract as {@link isSafetyClassKey}. Kept a separate predicate
 * rather than widening the safety one because the two classes now point in
 * OPPOSITE directions: a safety hook adopts unless `--no-adopt-safety`, a gate
 * spine withholds unless `--adopt-gate-spine`.
 */
export function isGateSpineKey(key: string): boolean {
  return GATE_SPINE_PATTERN.test(key)
}

/**
 * True when `key` names a governance-class file (#2120). Same key contract as
 * {@link isSafetyClassKey}. See {@link GOVERNANCE_CLASS_KEYS} for why the class
 * is an explicit pair rather than a pattern.
 */
export function isGovernanceClassKey(key: string): boolean {
  return GOVERNANCE_CLASS_KEYS.has(key)
}
