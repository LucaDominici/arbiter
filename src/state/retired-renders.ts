// SPDX-License-Identifier: Apache-2.0
/**
 * Known-render registry for RETIRED files (#2221).
 *
 * The manifest proves ownership only where a manifest exists. Measured on the
 * two consumers that redden the Consumer Reliability Bar: the typescript one
 * carries `.arbiter-generated-manifest.json` at its pinned commit and the go
 * one does NOT — its orphan hook is on disk with no provenance record anywhere
 * in the repo. Manifest-only retirement therefore reaches one of the two.
 *
 * This registry is the second, weaker-but-sufficient ownership proof the issue
 * actually asked for: a file whose sha256 equals a render ARBITER ITSELF once
 * emitted for that exact path is arbiter-owned and unmodified, whatever the
 * target's manifest says. Byte-identity to a known render is not a heuristic —
 * a user-edited copy cannot hash to it.
 *
 * Rules for adding an entry, and they are the whole safety of the mechanism:
 *   - The path must be one arbiter STOPPED emitting. A path any generator still
 *     writes has no business here (retirement also skips anything visited).
 *   - The hashes must come from arbiter's own history — the materialized
 *     `examples/*` copies are the canonical record of what a consumer received.
 *     NOT arbiter's own `.claude/` copy, which is hand-maintained and diverges
 *     (the `pre-task-track-detect.mjs` self-copy hashes to `4beef7bd…`, a
 *     variant no consumer ever had; listing it would license deleting a
 *     modified file).
 *   - Every historical render for the path, not only the last: a consumer can
 *     be pinned to any older version.
 *
 * A file matching none of the listed hashes is REPORTED, never deleted — the
 * user changed it, and the change is theirs.
 */
export const RETIRED_RENDERS: Readonly<Record<string, readonly string[]>> = {
  // Retired in 647c3373 (dead-code prune). One render across its whole life,
  // verified across every commit that touched the materialized examples copies.
  '.claude/hooks/pre-task-track-detect.mjs': [
    'ef079009f8e6fbab3dce3528bbb5cb2e95ccd2644f020a307099e5d2deac6140',
  ],
}
