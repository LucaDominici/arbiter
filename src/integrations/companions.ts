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
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import { runCli } from '../utils/run-cli.js'
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

export interface CompanionDiffStats {
  files: number
  insertions: number
  deletions: number
}

export const CompanionEvidenceV1 = z.object({
  $schemaVersion: z.literal(1),
  companions: z
    .array(
      z.object({
        id: z.string().min(1),
        mode: z.enum(['lite', 'full']),
      }),
    )
    .min(1),
  diffStats: z.object({
    files: z.number().int().nonnegative(),
    insertions: z.number().int().nonnegative(),
    deletions: z.number().int().nonnegative(),
  }),
  recordedAt: z.string().datetime(),
})

export type CompanionEvidenceV1 = z.infer<typeof CompanionEvidenceV1>

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

/**
 * Defense-in-depth below the schema validator: an override mode outside the lite|full
 * union (e.g. `ultra` from a hand-built map) falls back to the normal precedence chain
 * instead of propagating — explicit override > conservative stack default > policy
 * default — so ultra stays unrepresentable end-to-end.
 */
function resolveMode(
  override: CompanionOverride | undefined,
  policy: CompanionPolicy,
  language: string | undefined,
): CompanionMode {
  const mode = override?.mode
  if (mode === 'lite' || mode === 'full') return mode
  return defaultModeForStack(language, policy)
}

function defaultModeForStack(language: string | undefined, policy: CompanionPolicy): CompanionMode {
  return language !== undefined && CONSERVATIVE_LITE_STACKS.has(language)
    ? 'lite'
    : policy.defaultMode
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

export function companionEvidencePath(taskId: string, repoDir: string): string {
  return join(repoDir, '.arbiter', 'evidence', 'companions', `${taskId}.json`)
}

export interface WriteCompanionEvidenceInput {
  repoDir: string
  taskId: string
  isArbiterSelf: boolean
  companions: readonly ActiveCompanion[]
  recordedAt?: string
  gatherDiffStats?: (repoDir: string) => CompanionDiffStats
}

export function writeCompanionEvidence(input: WriteCompanionEvidenceInput): string | null {
  if (input.isArbiterSelf || input.companions.length === 0) return null
  const evidence: CompanionEvidenceV1 = {
    $schemaVersion: 1,
    companions: input.companions.map((c) => ({ id: c.id, mode: c.mode })),
    diffStats: (input.gatherDiffStats ?? gatherCompanionDiffStats)(input.repoDir),
    recordedAt: input.recordedAt ?? new Date().toISOString(),
  }
  const parsed = CompanionEvidenceV1.safeParse(evidence)
  if (!parsed.success) {
    throw new Error(`Invalid companion evidence: ${parsed.error.message}`)
  }
  const out = companionEvidencePath(input.taskId, input.repoDir)
  mkdirSync(join(input.repoDir, '.arbiter', 'evidence', 'companions'), { recursive: true })
  writeFileSync(out, `${JSON.stringify(parsed.data, null, 2)}\n`, 'utf-8')
  return out
}

export function gatherCompanionDiffStats(repoDir: string): CompanionDiffStats {
  const base = diffBase(repoDir)
  const range = base ? `${base}...HEAD` : 'HEAD'
  try {
    return parseShortstat(runCli('git', ['diff', '--shortstat', range], { cwd: repoDir }).stdout)
  } catch {
    return { files: 0, insertions: 0, deletions: 0 }
  }
}

function diffBase(repoDir: string): string | null {
  for (const ref of ['origin/main', 'main']) {
    try {
      return runCli('git', ['merge-base', 'HEAD', ref], { cwd: repoDir }).stdout.trim()
    } catch {
      // Try the next local base ref; evidence remains best-effort when no base exists.
    }
  }
  return null
}

function parseShortstat(shortstat: string): CompanionDiffStats {
  const files = Number((shortstat.match(/(\d+) files? changed/) ?? [])[1] ?? 0)
  const insertions = Number((shortstat.match(/(\d+) insertions?\(\+\)/) ?? [])[1] ?? 0)
  const deletions = Number((shortstat.match(/(\d+) deletions?\(-\)/) ?? [])[1] ?? 0)
  return { files, insertions, deletions }
}
