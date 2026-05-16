// SPDX-License-Identifier: Apache-2.0
/**
 * Snapshot migration v0 → v1 (#607).
 *
 * v0 = bare `ArbiterConfig` JSON (the historical shape of
 * `.arbiter-generated.json`). v1 = envelope `{ $schemaVersion: 1, config }`
 * with a `.checksum` field added on write by `wrapSnapshot`.
 */

import type { SnapshotEnvelopeV1 } from '../envelope.js'

export function migrateV0ToV1(raw: unknown): SnapshotEnvelopeV1 {
  return { $schemaVersion: 1, config: raw }
}
