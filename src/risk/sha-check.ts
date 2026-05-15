// SPDX-License-Identifier: Apache-2.0
/**
 * SHA validator for .evidence/SUMMARY.json (#238).
 *
 * The SUMMARY.json file is the canonical snapshot of an evidence run.
 * Its embedded `sha` is computed over a canonicalised representation of
 * the rest of the object — any tampering or stale state surfaces as a
 * mismatch that `arbiter verify evidence` treats as exit code 2.
 *
 * Canonicalisation strategy: sort keys deeply, exclude the `sha` field
 * itself, then SHA-256 the resulting JSON string.
 */

import { createHash } from 'node:crypto'

export interface SummaryVerifyResult {
  ok: boolean
  expected?: string
  actual?: string
  reason?: string
}

function canonicalise(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalise)
  }
  if (value !== null && typeof value === 'object') {
    const obj = value as Record<string, unknown>
    const sortedKeys = Object.keys(obj).sort()
    const out: Record<string, unknown> = {}
    for (const k of sortedKeys) {
      out[k] = canonicalise(obj[k])
    }
    return out
  }
  return value
}

/**
 * Compute the canonical SHA-256 of a SUMMARY.json body.
 * Any embedded `sha` field is excluded before hashing.
 */
export function computeSummarySha(body: Record<string, unknown>): string {
  const { sha: _ignored, ...rest } = body
  void _ignored
  const canonical = JSON.stringify(canonicalise(rest))
  return createHash('sha256').update(canonical).digest('hex')
}

/**
 * Validate that a parsed SUMMARY.json's embedded `sha` matches the
 * canonical hash of the rest of its body. Missing/non-string `sha` is
 * treated as a mismatch (fail-closed).
 */
export function verifySummarySha(body: Record<string, unknown>): SummaryVerifyResult {
  const stored = body['sha']
  if (typeof stored !== 'string') {
    return { ok: false, reason: 'missing or non-string sha field' }
  }
  const expected = computeSummarySha(body)
  if (expected !== stored) {
    return { ok: false, expected, actual: stored, reason: 'sha mismatch' }
  }
  return { ok: true, expected, actual: stored }
}
