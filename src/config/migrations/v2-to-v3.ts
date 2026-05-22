// SPDX-License-Identifier: Apache-2.0
/**
 * Migration: v2 ($schemaVersion: 2) → v3 ($schemaVersion: 3)
 *
 * Additive-only migration: re-stamps the schema version to 3.
 * No data transforms — GovernanceLevel is widened (L4 added) but existing
 * L1/L2/L3 values remain valid. Evidence harness / STRIDE / TRACK_ROUTER
 * gating moves to L4-only; existing project files are not modified.
 *
 * Issue: #1002
 */

import type { ArbiterConfigV2 } from '../schema.js'

export function migrateV2ToV3(config: ArbiterConfigV2): ArbiterConfigV2 {
  return { ...config, $schemaVersion: 3 }
}
