// SPDX-License-Identifier: Apache-2.0
// #2282: describe why a spawnSync child failed, so a red run diagnoses itself.
//
// `expect(r.status, r.stderr).toBe(0)` throws away everything that distinguishes the
// failure modes: a child killed by a signal (OOM-killer, timeout kill) reports
// `status: null` with an EMPTY stderr, which is indistinguishable from a clean timeout
// when stderr is all you print. `signal` and `error` are the two fields that tell them
// apart, and they were being discarded at the one call site that most needed them.
import type { SpawnSyncReturns } from 'node:child_process'

/** The fields that carry failure identity. Deliberately NOT the full `SpawnSyncReturns`:
 *  that type also requires `pid`/`output`/`stdout`, which a caller describing a failure
 *  has no reason to supply and a test fixture cannot synthesise without noise. */
export type SpawnFailureFields = Pick<SpawnSyncReturns<string>, 'stderr' | 'signal' | 'error'>

/** Human-readable failure description for a spawnSync result. */
export function describeSpawnResult(r: SpawnFailureFields): string {
  return r.stderr
}
