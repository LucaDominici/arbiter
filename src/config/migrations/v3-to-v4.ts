// SPDX-License-Identifier: Apache-2.0
/**
 * Migration: v3 ($schemaVersion: 3) → v4 ($schemaVersion: 4)
 *
 * Additive-only: stamps schema version to 4 and initialises `kit.measure`
 * (empty object) if absent. Existing measure entries are preserved.
 *
 * Issue: #1043
 */

import type { ArbiterConfigV2 } from '../schema.js'

export function migrateV3ToV4(config: ArbiterConfigV2): ArbiterConfigV2 {
  return {
    ...config,
    $schemaVersion: 4,
    kit: {
      ...(config.kit ?? {}),
      measure: config.kit?.measure ?? {},
    },
  }
}
