// SPDX-License-Identifier: Apache-2.0
//
// #1730 — companion-plugin resolution for /ship. Maps skills installed in the user's Claude
// HOME to their ship-phase companion policy, under the self-and-mode guards, and renders the
// green-phase instruction + the `Companion:` announcement.
//
// Two design guarantees the red-team required:
//   • HOME-ONLY detection — detectInstalledSkills is called with targetDir:'' so an untrusted
//     target repo can never spoof a companion by committing `.claude/plugins/ponytail`. This
//     module takes no targetDir at all; a caller structurally cannot point it at a repo tree.
//   • NO cycle — this leaf imports only from integrations/ (skills-matrix, skill-detector). It
//     takes primitives (never a ShipProfile) so ship-profile.ts can value-import it freely.
import { detectInstalledSkills } from './skill-detector.js'
import { SKILLS_MATRIX, bareName } from './skills-matrix.js'
import type { CompanionPolicy } from './skills-matrix.js'

/** The resolved activation mode. `ultra` is deliberately unrepresentable (it skips tests). */
export type CompanionMode = 'lite' | 'full'

/** A companion that resolution decided is active for this ship run. */
export interface ActiveCompanion {
  /** The registry skillId, e.g. `ponytail:ponytail`. */
  id: string
  /** Display label for the announcement. */
  label: string
  /** Resolved mode (policy default unless the config overrode it). */
  mode: CompanionMode
  /** The registry policy (carries the green-phase instruction template). */
  policy: CompanionPolicy
}

/** Per-companion override read from `arbiter.json` → `companions`. Keyed by bare name or full id. */
export interface CompanionOverride {
  /** `false` disables an installed companion without uninstalling it. */
  enabled?: boolean
  /** Force a mode other than the policy default (never `ultra`). */
  mode?: CompanionMode
}

export interface ResolveCompanionsInput {
  /** True on arbiter-self — no companion ever activates (arbiter complexity is load-bearing). */
  self: boolean
  /** The user's Claude home (`~/.claude`). The ONLY tree scanned — never a target repo. */
  claudeHome: string
  /** Optional per-companion overrides from arbiter.json, keyed by bare name or full skillId. */
  overrides?: Record<string, CompanionOverride>
}

/**
 * Resolve the companions active for a ship run. Deterministic (SKILLS_MATRIX order, no
 * timestamps, home-only scan is itself sorted). Empty on arbiter-self, when nothing is
 * installed, or when every installed companion is disabled by config.
 */
export function resolveCompanions(input: ResolveCompanionsInput): ActiveCompanion[] {
  if (input.self) return []
  // HOME-ONLY: empty targetDir makes the detector skip the repo scan entirely (skill-detector
  // early-returns on a falsy base), closing the target-repo spoofing vector.
  const installed = detectInstalledSkills({ targetDir: '', claudeHome: input.claudeHome })
  const installedIds = new Set(installed.map((s) => s.skillId))
  const installedBare = new Set(installed.map((s) => bareName(s.skillId)))

  const active: ActiveCompanion[] = []
  for (const entry of SKILLS_MATRIX) {
    const policy = entry.companion
    if (!policy) continue
    const detected = installedIds.has(entry.id) || installedBare.has(bareName(entry.id))
    if (!detected) continue
    const override = input.overrides?.[bareName(entry.id)] ?? input.overrides?.[entry.id]
    if (override?.enabled === false) continue
    active.push({
      id: entry.id,
      label: policy.label,
      mode: override?.mode ?? policy.defaultMode,
      policy,
    })
  }
  return active
}

/**
 * The instruction appended to the green-phase action, one sentence per active companion (in
 * registry order). Empty string when no active companion composes with the green phase, so the
 * caller appends nothing and the phase action is byte-identical to a companion-free ship.
 */
export function companionGreenInstruction(active: readonly ActiveCompanion[]): string {
  return active
    .filter((c) => c.policy.greenInstruction)
    .map((c) => (c.policy.greenInstruction ?? '').replaceAll('{mode}', c.mode))
    .join(' ')
}

/**
 * The `Companion:` announcement payload — `label (mode)` per active companion, comma-joined in
 * registry order. Empty string when none are active (the caller then prints no line at all,
 * mirroring the "surfaced, not faked" self-only-checks rendering).
 */
export function companionStatusLine(active: readonly ActiveCompanion[]): string {
  return active.map((c) => `${c.label} (${c.mode})`).join(', ')
}
