// SPDX-License-Identifier: Apache-2.0
/**
 * `.arbiter-generated.json` envelope (#607 #619).
 *
 * The snapshot file is a wrapper around the ArbiterConfig with two meta
 * fields: a SHA-256 checksum covering the inner payload and a schema
 * version that drives the migration chain. The envelope is intentionally
 * separate from `ArbiterConfig` so the config schema can evolve
 * independently of the storage format.
 *
 * Canonical serialisation (used for checksum):
 *   JSON.stringify({ $schemaVersion, config }, sortedReplacer, 2)
 *
 * Storage layout on disk (top-of-file `.checksum` first per #619 AC):
 *   { ".checksum": "<hex>", "$schemaVersion": 1, "config": { ... } }
 */
import { createHash } from 'node:crypto'

export const CURRENT_SNAPSHOT_VERSION = 1

export interface SnapshotEnvelopeV1<Config = unknown> {
  $schemaVersion: 1
  config: Config
}

export interface PersistedSnapshot<Config = unknown> extends SnapshotEnvelopeV1<Config> {
  '.checksum': string
}

/** Stable JSON for checksum + write — sorts object keys recursively. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(value, sortedReplacer, 2)
}

function sortedReplacer(_key: string, value: unknown): unknown {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a.localeCompare(b),
    )
    return Object.fromEntries(entries)
  }
  return value
}

export function computeChecksum(envelope: SnapshotEnvelopeV1): string {
  return createHash('sha256').update(canonicalJson(envelope)).digest('hex')
}

export function wrapSnapshot<C>(config: C): PersistedSnapshot<C> {
  const envelope: SnapshotEnvelopeV1<C> = {
    $schemaVersion: CURRENT_SNAPSHOT_VERSION,
    config,
  }
  return { '.checksum': computeChecksum(envelope), ...envelope }
}

export interface UnwrapResult<C> {
  envelope: SnapshotEnvelopeV1<C>
  checksum: string
}

export class SnapshotChecksumError extends Error {
  readonly expected: string
  readonly actual: string
  constructor(expected: string, actual: string) {
    super(
      `snapshot checksum mismatch: expected ${expected.slice(0, 12)}…, got ${actual.slice(0, 12)}…. ` +
        `Run \`arbiter doctor --repair-state\` to re-derive from arbiter.json.`,
    )
    this.name = 'SnapshotChecksumError'
    this.expected = expected
    this.actual = actual
  }
}

export class SnapshotShapeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SnapshotShapeError'
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/**
 * Verify the persisted snapshot has a valid envelope shape and the
 * embedded checksum matches recomputation. Throws `SnapshotChecksumError`
 * on mismatch (#619: HARD error, no silent recovery).
 */
export function unwrapSnapshot<C = unknown>(raw: unknown): UnwrapResult<C> {
  if (!isRecord(raw)) {
    throw new SnapshotShapeError('snapshot is not a JSON object')
  }
  const checksum = raw['.checksum']
  const version = raw['$schemaVersion']
  const config = raw['config']
  if (typeof checksum !== 'string') {
    throw new SnapshotShapeError('snapshot missing ".checksum" string')
  }
  if (typeof version !== 'number') {
    throw new SnapshotShapeError('snapshot missing "$schemaVersion" number')
  }
  if (config === undefined) {
    throw new SnapshotShapeError('snapshot missing "config" payload')
  }
  const envelope: SnapshotEnvelopeV1<C> = {
    $schemaVersion: version as 1,
    config: config as C,
  }
  const actual = computeChecksum(envelope)
  if (actual !== checksum) {
    throw new SnapshotChecksumError(checksum, actual)
  }
  return { envelope, checksum }
}
