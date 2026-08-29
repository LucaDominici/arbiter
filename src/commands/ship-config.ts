// SPDX-License-Identifier: Apache-2.0
/**
 * #2402 — the one place that reads the TARGET repo's `arbiter.json` for ship/landing policy.
 *
 * Three callers now need it (train bounds, review-round cap, landing verification) and each was
 * about to grow its own `loadConfig` + try/catch, which is the duplication the debt ratchet
 * exists to stop. It also has to live outside `task-ship.ts`, because `task.ts` needs it too and
 * `task-ship.ts` already imports `task.ts` — a reader placed there would close a module cycle.
 *
 * CANON-16 existing-code survey: `resolveShipProfile` (ship-profile.ts) already wraps `loadConfig`
 * with the same degrade-on-throw, but it returns a 7-field runtime PROFILE and pulls in the
 * companion/language/override resolvers; importing it from `task.ts` for two booleans would drag
 * that whole graph into the task engine. This is the two-line reader those callers actually want.
 */
import { loadConfig } from '../utils/config.js'
import type { ShipConfig } from '../config/schema.js'

/**
 * The `ship` block, or undefined when absent or unreadable.
 *
 * FAIL-SAFE, matching `resolveShipProfile`: `loadConfig` THROWS on a malformed config (absent
 * returns null), and a config typo must not brick the ship — "declares nothing" leaves every
 * built-in bound in force.
 */
export function shipConfigFor(root: string): ShipConfig | undefined {
  try {
    return loadConfig(root)?.ship
    // FAIL-OPEN-INTENT: "declares nothing" leaves every built-in bound in force - the STRICT side, since a config typo then widens no limit and grants no permission.
  } catch {
    return undefined
  }
}

/**
 * May arbiter make live GitHub calls in this repo?
 *
 * `permitGitHub` is the canonical axis — `loadConfig` migrates the deprecated `useGitHub` onto it
 * and deletes the old key, so reading `useGitHub` here would always see `undefined`. Only an
 * explicit `true` permits: an absent or unreadable config has not granted permission, and
 * shelling out to `gh` against a repo that never asked for it is worse than skipping a check.
 * Callers that skip on `false` must LOG the skip — silent is what makes a gate a decoration.
 */
export function permitsGitHubCalls(root: string): boolean {
  try {
    return loadConfig(root)?.permitGitHub === true
    // FAIL-OPEN-INTENT: an unreadable config has not granted permission, so this denies - the swallow IS the fail-closed answer, and surfacing it would only add noise to a denial.
  } catch {
    return false
  }
}
