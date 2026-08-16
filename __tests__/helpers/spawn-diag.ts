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

/** Human-readable failure description for a spawnSync result: stderr PLUS the two fields
 *  that identify a non-exit failure. Empty parts are omitted so a plain non-zero exit with
 *  real stderr reads exactly as it did before. */
export function describeSpawnResult(r: SpawnFailureFields): string {
  const parts: string[] = []
  if (r.stderr) parts.push(r.stderr)
  if (r.signal) parts.push(`killed by signal ${r.signal}`)
  if (r.error) parts.push(`spawn error: ${r.error.message}`)
  return parts.length > 0 ? parts.join(' | ') : '(no stderr, no signal, no spawn error)'
}
