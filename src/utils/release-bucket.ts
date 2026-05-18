// SPDX-License-Identifier: Apache-2.0
import type { Archetype } from '../wizard/types.js'

/**
 * Four-way release tier bucket that drives T3 archetype-aware publish jobs.
 *
 * Maps the six existing Archetype values to the four buckets defined in
 * docs/SYSTEM/CI-TIER-MODEL.md §5:
 *
 *   library, frontend-spa → lib     (package publish)
 *   backend-web-db        → service (container build + sign)
 *   cli, embedded         → cli     (cross-platform binary matrix)
 *   data-pipeline         → batch   (tarball + manifest)
 */
export type ReleaseBucket = 'lib' | 'service' | 'cli' | 'batch'

const BUCKET_MAP: Record<Archetype, ReleaseBucket> = {
  library: 'lib',
  'frontend-spa': 'lib',
  'backend-web-db': 'service',
  cli: 'cli',
  embedded: 'cli',
  'data-pipeline': 'batch',
}

export function releaseBucket(archetype: Archetype): ReleaseBucket {
  return BUCKET_MAP[archetype]
}
