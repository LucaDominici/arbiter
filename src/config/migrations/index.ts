/**
 * Config migration orchestrator.
 *
 * Accepts a raw unknown value from arbiter.json (any version) and returns
 * a fully-validated ArbiterConfigV2. The migration chain is:
 *
 *   v0 (no version) → v1 (version "0.1") → v2 (version "0.2")
 *
 * All steps are idempotent — calling migrate() on an already-migrated v2
 * config returns a structurally equal object.
 *
 * Issue: #231
 */

import type { ArbiterConfigV2 } from "../schema.js";
import { migrateV0ToV1 } from "./v0-to-v1.js";
import { migrateV1ToV2 } from "./v1-to-v2.js";

function isRecord(val: unknown): val is Record<string, unknown> {
  return typeof val === "object" && val !== null && !Array.isArray(val);
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
    throw new Error("arbiter.json must be a non-null object");
  }

  const version = raw["version"];

  // Already v2 — delegate to v1-to-v2 which handles idempotent passthrough
  if (version === "0.2") {
    return migrateV1ToV2(raw);
  }

  // v1 — one hop to v2
  if (version === "0.1") {
    return migrateV1ToV2(raw);
  }

  // v0 — no version field: stamp "0.1" then continue to v2
  const v1 = migrateV0ToV1(raw);
  return migrateV1ToV2(v1);
}
