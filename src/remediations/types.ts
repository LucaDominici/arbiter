// SPDX-License-Identifier: Apache-2.0
// Remediation playbook types (#1422 — close-gold-gap).
//
// A "gap" is a single N/P check emitted by the gold-audit engine. The remediation subsystem maps
// each gap (keyed by the engine's check `type` + `dimension`) to a deterministic, NON-EXECUTING
// RECIPE: typed steps that DELEGATE to the existing tools (`check-doc-set --generate`, the `tdd`
// skill, config writers) and cite the SSOT they write + the evidence they close.
//
// Anti-fake-green is STRUCTURAL here, not prose:
//   - A `manual`-typed check (engine verdict NV — excluded from the score denominator) routes to a
//     HUMAN-ACTION-ONLY playbook with NO code recipe (`kind: 'process'`, `code: false`).
//   - A doc-set scaffold (`check-doc-set --generate` writes "STUB — fill me in.") satisfies a
//     presence check but is fake-green. Such a recipe is `expectedVerdict: 'P'` (NOT 'Y') and its
//     steps chain scaffold→fill — presence alone is never claimed as closure.
//   - No step may suppress a check (no `--no-verify` / `skip` / `ignore` / `eslint-disable`), and no
//     step may write the matched `pattern`/`equals` literal as its sole action (no marker-stuffing).
// These invariants are validated by code (catalog load + tests), so a future edit that violates
// them fails the gate rather than silently shipping a fake-close.

/** The consumed gold-audit check shape (verbatim subset of the engine payload). */
export interface RemediationGap {
  /** Stable check id (e.g. `GA-DOC-03`). */
  id: string
  /** Grouping family (e.g. `D-DOCS`). */
  dimension: string
  /** Human-readable check title. */
  title: string
  /** Engine check type — the primary catalog routing key. */
  type: 'file_exists' | 'file_contains' | 'count_matches' | 'value' | 'manual'
  /**
   * Actionable verdict. Code-verifiable gaps are N (verified-false) or P (partial). A `manual`
   * check is NV (code cannot verify it) — still actionable by a HUMAN, so it is accepted here and
   * routed to the process (human-only) playbook.
   */
  verdict: 'N' | 'P' | 'NV'
  /** Optional INV-NN anchor the check enforces. */
  anchor: string | null
  /** Code-verifiable evidence (the file/pattern that was absent), or null for manual checks. */
  evidence: { file?: string; line?: number; detail?: string } | null
}

/** What category of work closes this gap — also gates whether a code recipe is permitted. */
export type RemediationKind = 'doc-set' | 'test' | 'config' | 'process'

/** One concrete, deterministic remediation step. A step DELEGATES — it never executes here. */
export interface RemediationStep {
  /** Imperative human/agent instruction. */
  action: string
  /** Optional command this step DELEGATES to (run by the human/agent, not by this module). */
  delegateCommand?: string
  /** Optional skill this step DELEGATES to (e.g. `tdd`). */
  delegateSkill?: string
}

/** A typed remediation recipe produced by a handler for a single gap. */
export interface RemediationPlan {
  /** The gap this plan closes. */
  gapId: string
  /** Work category — `process` is human-only (no code recipe). */
  kind: RemediationKind
  /**
   * The HONEST verdict a correctly-executed recipe earns on re-audit:
   *   - 'Y'  the recipe genuinely closes the check (content written + verified)
   *   - 'P'  the recipe only scaffolds presence (e.g. a doc stub) — partial, not closure
   *   - 'NV' a human-only process step (manual check) — code can never verify it
   */
  expectedVerdict: 'Y' | 'P' | 'NV'
  /** True only when the recipe contains executable code steps (false for `process`). */
  code: boolean
  /** The SSOT document(s) this recipe writes to / cites (e.g. `standards/gold-doc-set.yml`). */
  ssot: string[]
  /** The evidence (from the gap) the recipe must close — anchors the "real reason" on re-audit. */
  evidence: string
  /** Ordered, deterministic remediation steps. */
  steps: RemediationStep[]
}

/** A catalog entry: routing key (type [+ dimension]) → recipe template metadata. */
export interface CatalogEntry {
  /** Engine check type this entry handles. */
  type: RemediationGap['type']
  /** Optional dimension refinement (more specific than `type` alone). */
  dimension?: string | undefined
  /** The remediation category (selects the handler). */
  kind: RemediationKind
  /** Honest expected verdict for the produced recipe (see RemediationPlan.expectedVerdict). */
  expectedVerdict: RemediationPlan['expectedVerdict']
  /** SSOT path(s) the recipe writes/cites. */
  ssot: string[]
  /** Human-readable rationale shown in the recipe header. */
  rationale: string
}

/** The full deterministic playbook catalog (loaded + validated from playbook-catalog.json). */
export interface PlaybookCatalog {
  version: string
  /** Default entry per check type (the floor when no dimension override matches). */
  byType: Record<RemediationGap['type'], CatalogEntry>
  /** Optional per-(type,dimension) overrides, keyed `"<type>:<dimension>"`. */
  overrides: Record<string, CatalogEntry>
}
