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
