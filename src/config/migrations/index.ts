// SPDX-License-Identifier: Apache-2.0
/**
 * Config migration orchestrator.
 *
 * Accepts a raw unknown value from arbiter.json (any version) and returns
 * a fully-validated ArbiterConfigV2. The migration chain is:
 *
 *   v0 (no version) → v1 (version "0.1") → v2 (version "0.2") → v3 ($schemaVersion: 3)
 *
 * All steps are idempotent — calling migrate() on an already-migrated v3
 * config returns a structurally equal object.
 *
 * Issue: #231, #1002
 */

import { CURRENT_CONFIG_SCHEMA_VERSION, type ArbiterConfigV2 } from '../schema.js'
import { migrateV0ToV1 } from './v0-to-v1.js'
import { migrateV1ToV2 } from './v1-to-v2.js'
import { migrateV2ToV3 } from './v2-to-v3.js'

function isRecord(val: unknown): val is Record<string, unknown> {
  return typeof val === 'object' && val !== null && !Array.isArray(val)
}

/**
 * Migrate any versioned or pre-versioned arbiter config to ArbiterConfigV2.
 *
 * Version routing:
 * - `version === "0.2"` → v2 passthrough (validates + applies decomposition alias)
 * - `version === "0.1"` → v1 → v2
 * - no version field    → v0 → v1 → v2
 *
 * @throws if the input is not a non-null object, or if a v2 input is invalid.
 */
export function migrate(raw: unknown): ArbiterConfigV2 {
  if (!isRecord(raw)) {
    throw new Error('arbiter.json must be a non-null object')
  }

  const schemaVersion = raw['$schemaVersion']
  if (typeof schemaVersion === 'number' && schemaVersion > CURRENT_CONFIG_SCHEMA_VERSION) {
    throw new Error(
      `arbiter.json has $schemaVersion=${schemaVersion} but this arbiter build understands at most ${CURRENT_CONFIG_SCHEMA_VERSION}. ` +
        `Upgrade arbiter or downgrade the config file.`,
    )
  }

  const version = raw['version']

  // Already v2 — delegate to v1-to-v2 which handles idempotent passthrough, then stamp v3
  if (version === '0.2') {
    return migrateV2ToV3(migrateV1ToV2(raw))
  }

  // v1 — one hop to v2, then stamp v3
  if (version === '0.1') {
    return migrateV2ToV3(migrateV1ToV2(raw))
  }

  // v0 — no version field: stamp "0.1" then continue to v2, then v3
  const v1 = migrateV0ToV1(raw)
  return migrateV2ToV3(migrateV1ToV2(v1))
}
