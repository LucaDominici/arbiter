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
import type { CollaborationMode, GovernanceLevel } from '../../wizard/types.js'

export type CoherenceSeverity = 'OK' | 'WARN' | 'CRITICAL'

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
const HEAVY_OVERLAYS: ReadonlySet<IndustryOverlay> = new Set(['pharma', 'iso27001'])
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
