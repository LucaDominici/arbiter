// SPDX-License-Identifier: Apache-2.0
/**
 * Snapshot migration orchestrator (#607).
 *
 * Accepts a raw unknown read from `.arbiter-generated.json` and returns a
 * `SnapshotEnvelopeV1`. Two input shapes are supported:
 *   - v0: bare config blob (no envelope) — wrapped by v0→v1
 *   - v1: envelope with `$schemaVersion: 1` — passthrough
 *
 * v0 inputs by definition have no checksum, so callers must wrap (compute
 * checksum) on the migrated result before persisting.
 */
import type { SnapshotEnvelopeV1 } from '../envelope.js'
import { migrateV0ToV1 } from './v0-to-v1.js'

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function looksLikeEnvelope(raw: Record<string, unknown>): boolean {
  return typeof raw['$schemaVersion'] === 'number' && 'config' in raw
}

export interface MigrateStateResult<C = unknown> {
  envelope: SnapshotEnvelopeV1<C>
  /** True when the raw input had no envelope and was wrapped (v0→v1). */
  migrated: boolean
}

export function migrateState<C = unknown>(raw: unknown): MigrateStateResult<C> {
  if (!isRecord(raw)) {
    throw new Error('snapshot must be a non-null JSON object')
  }
  if (looksLikeEnvelope(raw)) {
    const version = raw['$schemaVersion']
    if (version !== 1) {
      throw new Error(`unsupported snapshot $schemaVersion=${String(version)} (max supported: 1)`)
    }
    const envelope: SnapshotEnvelopeV1<C> = {
      $schemaVersion: 1,
      config: raw['config'] as C,
    }
    return { envelope, migrated: false }
  }
  return { envelope: migrateV0ToV1(raw) as SnapshotEnvelopeV1<C>, migrated: true }
}
