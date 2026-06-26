// SPDX-License-Identifier: Apache-2.0
/**
 * ADR-051: wizard coherence validation for (CollaborationMode × GovernanceLevel) cells.
 *
 * Matrix (4×3 = 12 cells):
 * | mode \ level  | L1   | L2   | L3   | L4   |
 * |---------------|------|------|------|------|
 * | trunk-solo    | OK   | OK   | WARN | CRIT |
 * | peer-review   | OK   | OK   | OK   | WARN |
 * | gated-review  | WARN | OK   | OK   | OK   |
 *
 * CRITICAL → wizard rejects with remediation prompt.
 * WARN     → wizard emits advisory; arbiter doctor surfaces it.
 * OK       → no message.
 */
import type { Archetype, CollaborationMode, GovernanceLevel, Language } from '../../wizard/types.js'
import { AUTONOMY_LEVELS } from '../../config/schema.js'
import type { AutonomyLevel } from '../../config/schema.js'
import { levelAtLeast } from '../../config/levels.js'

type CoherenceSeverity = 'OK' | 'WARN' | 'CRITICAL'

/**
 * #1254: the industryOverlay axis. Mirrors `ProjectConfig.industryOverlay`,
 * exported here so the coherence layer (and the doctor/wizard callers) share a
 * single name for the compliance axis.
 */
export type IndustryOverlay =
  | 'pharma'
  | 'sox'
  | 'gdpr'
  | 'generic'
  | 'iso27001'
  | 'iso9001'
  | 'regulated'
  | 'none'

export interface CoherenceResult {
  valid: boolean
  severity: CoherenceSeverity
  message: string
  /** Present on CRITICAL results only. */
  remediation?: string
}

type MatrixEntry = Pick<CoherenceResult, 'severity' | 'message'> & {
  remediation?: string
}

const COHERENCE_MATRIX: Record<CollaborationMode, Record<GovernanceLevel, MatrixEntry>> = {
  'trunk-solo': {
    L1: { severity: 'OK', message: '' },
    L2: { severity: 'OK', message: '' },
    L3: {
      severity: 'WARN',
      message:
        'trunk-solo at L3: no human-approval gate is active. ' +
        'Cosign signatures bind to the dev identity only — no reviewer attestation. ' +
        'Acceptable under the §11.10(k) single-developer exception (ADR-091): arbiter ' +
        'generates the attestation doc, validation-evidence template, and reactivation ' +
        'trigger check (≥3 authors or EXTERNAL_AUDIT=true → CI fails, requiring manual switch to CODEOWNERS). ' +
        'See docs/governance/SOLO_DEV_EXCEPTION.md after running arbiter update.',
    },
    L4: {
      severity: 'CRITICAL',
      message:
        'L4 requires CODEOWNERS + human-approval attestation (ADR-050). ' +
        'trunk-solo bypasses both — the combination is incoherent.',
      remediation:
        'Switch collaborationMode to peer-review or gated-review, ' +
        'or downgrade governanceLevel to L3.',
    },
  },
  'peer-review': {
    L1: { severity: 'OK', message: '' },
    L2: { severity: 'OK', message: '' },
    L3: { severity: 'OK', message: '' },
    L4: {
      severity: 'WARN',
      message:
        'peer-review at L4: pr-ff merge mode is mandatory (no direct push allowed). ' +
        'If your config sets solo.mergeMode="direct", it will be overridden to "pr-ff".',
    },
  },
  'gated-review': {
    L1: {
      severity: 'WARN',
      message:
        'gated-review at L1: uncommon cell. ' +
        'CODEOWNERS + merge queue overhead is unusual for a lenient governance project. ' +
        'Consider peer-review unless you have specific audit requirements at L1.',
    },
    L2: { severity: 'OK', message: '' },
    L3: { severity: 'OK', message: '' },
    L4: { severity: 'OK', message: '' },
  },
}

/**
 * Validates a (collaborationMode × governanceLevel) cell against the ADR-051 coherence matrix.
 * Returns a CoherenceResult with severity OK | WARN | CRITICAL.
 */
export function validateCollaborationCoherence(
  mode: CollaborationMode,
  level: GovernanceLevel,
): CoherenceResult {
  const entry = COHERENCE_MATRIX[mode][level]
  const valid = entry.severity !== 'CRITICAL'
  return {
    valid,
    severity: entry.severity,
    message: entry.message,
    ...(entry.remediation !== undefined ? { remediation: entry.remediation } : {}),
  }
}

// ── #1254: overlay × governanceLevel coherence ───────────────────────────────
//
// Second coherence axis. The collaboration matrix above governs *who merges*;
// this one governs *compliance weight vs. governance rigour*. A heavy regulated
// overlay (pharma 21 CFR, ISO 27001 security controls) under L1 governance is a
// mismatch worth surfacing — the overlay scaffolds audit/security artefacts the
// L1 gate set never enforces. We FLAG (WARN), never block: an overlay never
// structurally breaks generation, so the strongest severity here is WARN.

/**
 * Compliance weight tiers. Heavy overlays expect L3/L4 rigour; medium overlays
 * expect at least L2 (debt + security gates). Light/none impose nothing.
 */
const HEAVY_OVERLAYS: ReadonlySet<IndustryOverlay> = new Set(['pharma', 'iso27001', 'regulated'])
const MEDIUM_OVERLAYS: ReadonlySet<IndustryOverlay> = new Set(['sox', 'gdpr', 'iso9001'])

/** Minimum governance level that makes a heavy overlay coherent. */
const HEAVY_MIN_LEVEL: GovernanceLevel = 'L3'
/** Minimum governance level that makes a medium overlay coherent. */
const MEDIUM_MIN_LEVEL: GovernanceLevel = 'L2'

const LEVEL_RANK: Record<GovernanceLevel, number> = { L1: 1, L2: 2, L3: 3, L4: 4 }

function belowLevel(level: GovernanceLevel, min: GovernanceLevel): boolean {
  return LEVEL_RANK[level] < LEVEL_RANK[min]
}

/**
 * Validate an (industryOverlay × governanceLevel) cell. Returns WARN when a
 * compliance overlay is selected under governance too lenient to enforce the
 * controls it scaffolds; OK otherwise. Never CRITICAL.
 *
 * - heavy (pharma, iso27001): WARN below L3.
 * - medium (sox, gdpr, iso9001): WARN below L2.
 * - light (generic) / none: always OK.
 */
export function validateOverlayCoherence(
  overlay: IndustryOverlay,
  level: GovernanceLevel,
): CoherenceResult {
  if (HEAVY_OVERLAYS.has(overlay) && belowLevel(level, HEAVY_MIN_LEVEL)) {
    return {
      valid: true,
      severity: 'WARN',
      message:
        `industryOverlay='${overlay}' is a heavy regulated overlay (audit-trail / security controls) ` +
        `but governanceLevel=${level} does not activate the mutation, evidence-harness, or human-approval ` +
        `gates these controls rely on. The overlay scaffolds the artefacts, but the gate set will not ` +
        `enforce them. Recommended: raise governanceLevel to ${HEAVY_MIN_LEVEL}+ (or downgrade the overlay).`,
    }
  }
  if (MEDIUM_OVERLAYS.has(overlay) && belowLevel(level, MEDIUM_MIN_LEVEL)) {
    return {
      valid: true,
      severity: 'WARN',
      message:
        `industryOverlay='${overlay}' is a compliance overlay but governanceLevel=${level} does not ` +
        `activate the debt + security-scan gates it complements. Recommended: raise governanceLevel ` +
        `to ${MEDIUM_MIN_LEVEL}+ so the overlay's controls are backed by enforced gates.`,
    }
  }
  return { valid: true, severity: 'OK', message: '' }
}

// ── #1292: automation.autonomy × governanceLevel × CI coherence (ADR-093 §4) ─
//
// Third coherence axis. L3 (full-auto wave + fix-on-red autopush) is only
// coherent when (a) CI exists — without a red signal the wave cannot verify its
// own pushes — and (b) governance stays below L4, whose human-approval mandate
// (ADR-050) the autonomous autopush would bypass. The matrix stays EXACTLY at
// the ADR boundary: L4 governance + L2 autonomy is the intended regulated
// workflow, not a warning.

/**
 * Validate an (automation.autonomy × governanceLevel × hasCi) cell.
 *
 * `autonomy` is accepted as a raw string because the doctor path reads
 * arbiter.json with a plain JSON.parse (no validateConfig): an unrecognized
 * literal is config drift surfaced as WARN, never a crash. Membership is
 * checked against `AUTONOMY_LEVELS` from the config schema — single source.
 *
 * - L3 + no CI            → CRITICAL (wave cannot verify; ADR-093 §4).
 * - governance L4 + L3    → CRITICAL (human-in-loop control violated).
 * - unrecognized literal  → WARN (run `arbiter update`).
 * - everything else       → OK.
 */
export function validateAutonomyCoherence(
  autonomy: string,
  level: GovernanceLevel,
  hasCi: boolean,
): CoherenceResult {
  if (!(AUTONOMY_LEVELS as readonly string[]).includes(autonomy)) {
    return {
      valid: true,
      severity: 'WARN',
      message:
        `automation.autonomy='${autonomy}' is not a recognized autonomy level ` +
        `(${AUTONOMY_LEVELS.join('|')}) — run \`arbiter update\` to repair the automation block.`,
    }
  }
  const a = autonomy as AutonomyLevel
  if (a === 'L3' && !hasCi) {
    return {
      valid: false,
      severity: 'CRITICAL',
      message:
        'automation.autonomy=L3 (full-auto wave) requires CI: without a red signal ' +
        'the wave cannot verify its own pushes (ADR-093 §4).',
      remediation:
        'Set automation.autonomy to L2 or lower, or enable CI ' +
        '(add a workflow file under .github/workflows/).',
    }
  }
  if (level === 'L4' && a === 'L3') {
    return {
      valid: false,
      severity: 'CRITICAL',
      message:
        'governanceLevel=L4 mandates human approval (ADR-050); automation.autonomy=L3 ' +
        'autonomous fix-on-red autopush violates the human-in-loop control.',
      remediation: 'Set automation.autonomy to L2 or lower, or downgrade governanceLevel.',
    }
  }
  return { valid: true, severity: 'OK', message: '' }
}

// ── #1306: Project-Profile orchestration prefs coherence (ADR-094 §Decision.5) ─
//
// Fourth coherence axis. Two independent checks on the #1306 fields:
//
// - maxParallelWorktrees > 1 under collaborationMode='trunk-solo' is INCOHERENT:
//   trunk-solo never uses worktrees (worktree auto-mode is 'optional' and a solo
//   dev ships on the trunk), so a >1 concurrency would never take effect — the
//   config promises parallelism the workflow cannot deliver. CRITICAL (the wizard
//   derives 1 for trunk-solo, so a >1 value here is a hand-edit mistake).
// - defaultGateLevel='L1' under L3/L4 governance is INCOHERENT-ish: the rigour tier
//   expects the heavier L2 gate by default; running L1 silently skips coverage /
//   mutation / evidence gates the tier relies on. WARN (it is a default, overridable
//   per-run, so advisory not blocking).
//
// The values are accepted defensively (raw, possibly undefined) because the doctor
// path reads arbiter.json with a plain JSON.parse — drift surfaces as a coherent
// floor, never a crash (RT-1306-08).

/**
 * Validate the (#1306) Project-Profile orchestration prefs against the collaboration
 * mode + governance level. An absent/non-numeric maxParallelWorktrees is treated as
 * the coherent floor (1); an absent defaultGateLevel never warns.
 *
 * - maxParallelWorktrees > 1 + trunk-solo → CRITICAL (worktree: never).
 * - defaultGateLevel L1 + governance L3/L4 → WARN (gate too lenient for the tier).
 * - everything else → OK.
 */
export function validateProfileCoherence(
  maxParallelWorktrees: number | undefined,
  defaultGateLevel: string | undefined,
  mode: CollaborationMode,
  level: GovernanceLevel,
): CoherenceResult {
  const mpw = typeof maxParallelWorktrees === 'number' ? maxParallelWorktrees : 1
  if (mpw > 1 && mode === 'trunk-solo') {
    return {
      valid: false,
      severity: 'CRITICAL',
      message:
        `automation.maxParallelWorktrees=${mpw} is incoherent with collaborationMode='trunk-solo': ` +
        'a solo-trunk workflow never uses worktrees, so the parallelism can never take effect.',
      remediation:
        'Set automation.maxParallelWorktrees to 1, or switch collaborationMode to peer-review/gated-review.',
    }
  }
  if (defaultGateLevel === 'L1' && levelAtLeast(level, 'L3')) {
    return {
      valid: true,
      severity: 'WARN',
      message:
        `automation.defaultGateLevel='L1' under governanceLevel=${level}: the L1 gate skips the ` +
        'coverage, mutation, and evidence gates the rigour tier relies on. Default verification ' +
        'runs leaner than the governance level implies.',
    }
  }
  return { valid: true, severity: 'OK', message: '' }
}

// ── #1347: language × archetype coherence (WARN | OK) ────────────────────────
//
// Fifth coherence axis. A handful of (language, archetype) pairs are ones arbiter
// cannot meaningfully scaffold — e.g. a `frontend-spa` for a server-only language
// like Go/Java (no SPA toolchain is emitted), or an `embedded` archetype for an
// interpreted/GC language like Python (no embedded toolchain). These pass init
// silently today, then surprise the user. We surface them as an advisory WARN at
// the same pre-init gate as the collaboration check (and reuse the same SSOT in
// doctor) — never CRITICAL: "absurd" is a judgement call with no blocking policy
// behind it, so a hard abort would need product sign-off. The set is deliberately
// small and conservative; unknown/multi language and an absent archetype are OK.

/** Incompatible (language → archetypes) pairs. Conservative, additive WARN set. */
const INCOMPATIBLE_LANGUAGE_ARCHETYPES: ReadonlyMap<Language, ReadonlySet<Archetype>> = new Map([
  // Server-only languages have no SPA front-end toolchain to scaffold.
  ['go', new Set<Archetype>(['frontend-spa'])],
  ['java', new Set<Archetype>(['frontend-spa'])],
  ['kotlin', new Set<Archetype>(['frontend-spa'])],
  // Interpreted/GC languages are not used for the embedded archetype.
  ['python', new Set<Archetype>(['embedded'])],
])

/**
 * Validate a (language × archetype) cell. Returns WARN for a pair arbiter cannot
 * meaningfully scaffold (e.g. go × frontend-spa, python × embedded); OK otherwise.
 * Never CRITICAL — this axis is advisory, never a hard block.
 *
 * `unknown`/`multi` language and an absent archetype are always OK (no false WARN):
 * detection fell back, so there is no asserted intent to contradict.
 */
export function validateLanguageArchetypeCoherence(
  language: Language,
  archetype: Archetype | undefined,
): CoherenceResult {
  if (archetype === undefined) return { valid: true, severity: 'OK', message: '' }
  const incompatible = INCOMPATIBLE_LANGUAGE_ARCHETYPES.get(language)
  if (incompatible?.has(archetype) === true) {
    return {
      valid: true,
      severity: 'WARN',
      message:
        `language='${language}' with archetype='${archetype}' is an unusual pairing: arbiter does ` +
        `not scaffold a meaningful ${archetype} toolchain for ${language}. The project will be ` +
        `generated, but the archetype-specific gates and structure will be absent. Recommended: ` +
        `pick an archetype that matches ${language}, or switch language.`,
    }
  }
  return { valid: true, severity: 'OK', message: '' }
}
