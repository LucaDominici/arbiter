// SPDX-License-Identifier: Apache-2.0
/**
 * Track→INV default mapping for CONTEXT_PACK generation (#254).
 *
 * Each track corresponds to a tier of invariants from AGENTS.md:
 *   A — Tier 1: Architectural Integrity
 *   B — Tier 5: Governance
 *   C — Tier 2 + 3: Data Integrity + Security & Compliance
 *   D — Tier 4: Operational Excellence
 */

export type Track = 'A' | 'B' | 'C' | 'D'

export type TrackInvMap = Record<Track, readonly string[]>

export const TRACK_INV_MAP: TrackInvMap = {
  /** Tier 1: Architectural Integrity */
  A: [
    'INV-01', // No circular dependencies
    'INV-02', // Intentional public API surface
    'INV-03', // Layer boundary enforcement
    'INV-04', // No `any` type
    'INV-05', // Cyclomatic complexity ≤ 15
    'INV-06', // No unused exports
    'INV-46', // Anti-bloat enforcement
  ],

  /** Tier 5: Governance */
  B: [
    'INV-21', // Every TODO comment must reference a task ID
    'INV-22', // Branch naming
    'INV-23', // No direct commits to main
    'INV-24', // Gate must pass before commit (L1)
    'INV-25', // Gate must pass before push (L2)
    'INV-26', // TDD mandatory
    'INV-27', // Evidence artifacts for all gate runs
    'INV-28', // SSOT documents must not contradict
  ],

  /** Tier 2 + Tier 3: Data Integrity + Security & Compliance */
  C: [
    'INV-07', // Schema changes via versioned migrations only
    'INV-08', // Input validation at system boundaries
    'INV-09', // Audit trail for mutable entities
    'INV-10', // Soft delete preferred
    'INV-11', // No secrets in source code
    'INV-12', // No PII in code, tests, or logs
    'INV-13', // Dependencies scanned for vulnerabilities
    'INV-14', // No dynamic code execution with untrusted input
    'INV-15', // Authentication required at every entry point
  ],

  /** Tier 4: Operational Excellence */
  D: [
    'INV-16', // No console.log in production code
    'INV-17', // Unhandled Promise rejections forbidden
    'INV-18', // No hardcoded environment values
    'INV-19', // Resilient external calls
    'INV-20', // Health and readiness endpoints
  ],
} as const
