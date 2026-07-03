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
import type { CompanionPolicy, SkillEntry } from './skills-matrix.js'

/** The resolved activation mode. `ultra` is deliberately unrepresentable (it skips tests). */
type CompanionMode = 'lite' | 'full'

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
interface CompanionOverride {
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
  /** Optional primitive language hint for conservative per-stack defaulting (`java` → lite). */
  language?: string
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
    const one = resolveOne(entry, installedIds, installedBare, input.overrides, input.language)
    if (one) active.push(one)
  }
  return active
}

/** Resolve a single registry entry to an active companion, or null when it does not activate. */
function resolveOne(
  entry: SkillEntry,
  installedIds: ReadonlySet<string>,
  installedBare: ReadonlySet<string>,
  overrides: Record<string, CompanionOverride> | undefined,
  language: string | undefined,
): ActiveCompanion | null {
  const policy = entry.companion
  if (!policy) return null
  if (!installedIds.has(entry.id) && !installedBare.has(bareName(entry.id))) return null
  const override = overrides?.[bareName(entry.id)] ?? overrides?.[entry.id]
  if (override?.enabled === false) return null
  return {
    id: entry.id,
    label: policy.label,
    mode: resolveMode(override, policy, language),
    policy,
  }
}

const CONSERVATIVE_LITE_STACKS = new Set(['java', 'kotlin', 'csharp'])

/** Where a resolved companion mode came from (#1747 — `doctor` surfaces this per entry). */
export type CompanionModeSource = 'arbiter.json override' | 'stack default' | 'policy default'

/**
 * Defense-in-depth below the schema validator: an override mode outside the lite|full
 * union (e.g. `ultra` from a hand-built map) falls back to the normal precedence chain
 * instead of propagating — explicit override > conservative stack default > policy
 * default — so ultra stays unrepresentable end-to-end. The sole source of the
 * (mode, source) pair; `resolveMode` and `diagnoseCompanions` both narrow from it so the
 * precedence chain is never duplicated (CANON-22).
 */
function resolveModeWithSource(
  override: CompanionOverride | undefined,
  policy: CompanionPolicy,
  language: string | undefined,
): { mode: CompanionMode; source: CompanionModeSource } {
  const mode = override?.mode
  if (mode === 'lite' || mode === 'full') return { mode, source: 'arbiter.json override' }
  if (language !== undefined && CONSERVATIVE_LITE_STACKS.has(language)) {
    return { mode: 'lite', source: 'stack default' }
  }
  return { mode: policy.defaultMode, source: 'policy default' }
}

function resolveMode(
  override: CompanionOverride | undefined,
  policy: CompanionPolicy,
  language: string | undefined,
): CompanionMode {
  return resolveModeWithSource(override, policy, language).mode
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

/**
 * #1747 — one per-registry-entry read-only diagnostic row for `arbiter doctor`'s Companions
 * section. Unlike {@link resolveCompanions} (which returns only the ACTIVE subset for `/ship`),
 * this reports every known companion — installed or not, enabled or not — because "silently
 * vanished after a machine rebuild" is exactly the failure doctor exists to surface.
 */
export interface CompanionDiagnostic {
  /** The registry skillId, e.g. `ponytail:ponytail`. */
  id: string
  /** Display label. */
  label: string
  /** True when the home-only scan found this skill installed. */
  installed: boolean
  /** True when `arbiter.json` sets `companions.<name>.enabled: false`. */
  disabledByConfig: boolean
  /** The mode that WOULD apply if installed and enabled (still computed when not installed, so
   * a user can see what activating it would resolve to). */
  mode: CompanionMode
  /** Where `mode` came from — surfaced so config precedence is never a guessing game. */
  modeSource: CompanionModeSource
}

export interface DiagnoseCompanionsInput {
  /** The user's Claude home (`~/.claude`). The ONLY tree scanned — same HOME-ONLY guard as
   * {@link resolveCompanions}. */
  claudeHome: string
  /** Optional primitive language hint for conservative per-stack defaulting (`java` → lite). */
  language?: string
  /** Optional per-companion overrides from arbiter.json, keyed by bare name or full skillId. */
  overrides?: Record<string, CompanionOverride>
}

/**
 * Diagnose every registry companion for `arbiter doctor`'s Companions section — installed state,
 * disabled-by-config state, and resolved mode + source, regardless of whether the companion would
 * actually activate on a ship run. Deterministic and read-only: no ship-run activation decision is
 * made here (that stays {@link resolveCompanions}'s job), so this can never diverge from `/ship`'s
 * own precedence chain (`resolveModeWithSource` is the single shared source).
 */
export function diagnoseCompanions(input: DiagnoseCompanionsInput): CompanionDiagnostic[] {
  const installed = detectInstalledSkills({ targetDir: '', claudeHome: input.claudeHome })
  const installedIds = new Set(installed.map((s) => s.skillId))
  const installedBare = new Set(installed.map((s) => bareName(s.skillId)))

  const out: CompanionDiagnostic[] = []
  for (const entry of SKILLS_MATRIX) {
    const policy = entry.companion
    if (!policy) continue
    const override = input.overrides?.[bareName(entry.id)] ?? input.overrides?.[entry.id]
    const { mode, source } = resolveModeWithSource(override, policy, input.language)
    out.push({
      id: entry.id,
      label: policy.label,
      installed: installedIds.has(entry.id) || installedBare.has(bareName(entry.id)),
      disabledByConfig: override?.enabled === false,
      mode,
      modeSource: source,
    })
  }
  return out
}
