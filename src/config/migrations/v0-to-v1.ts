/**
 * Migration: v0 → v1
 *
 * "v0" is any config object that either:
 *   - has no `version` field, OR
 *   - has a `version` value that is not recognized as a later format
 *
 * The v0 → v1 step stamps `version: "0.1"` on the object so the
 * downstream v1 → v2 migration can handle it uniformly.
 *
 * Issue: #231
 */

function isRecord(val: unknown): val is Record<string, unknown> {
  return typeof val === 'object' && val !== null && !Array.isArray(val)
}

/**
 * Normalises a v0 (pre-versioned) config into v1 shape.
 * Returns a new object with `version: "0.1"` stamped on.
 * Throws if the input is not a non-null plain object.
 */
export function migrateV0ToV1(raw: unknown): Record<string, unknown> {
  if (!isRecord(raw)) {
    throw new Error('arbiter.json must be a non-null object')
  }
  return { ...raw, version: '0.1' }
}
