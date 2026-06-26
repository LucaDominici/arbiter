// SPDX-License-Identifier: Apache-2.0
// The single remediation-handler contract (#1422).
//
// A handler is `(gap, ctx) => RemediationPlan`. It produces a deterministic RECIPE — typed steps
// that DELEGATE to existing tools (`check-doc-set --generate`, skill `tdd`, config writers) — and
// NEVER executes anything. Dispatch is keyed by the catalog entry's `kind` (one handler per kind),
// NOT four ad-hoc clones (CANON-22). Shared helpers live here so every handler cites SSOT + evidence
// the same way and no handler can omit them.

import type { CatalogEntry, RemediationGap, RemediationPlan } from '../types.js'

/** Per-invocation context (repo root + the resolved catalog entry for this gap). */
interface RemediationContext {
  /** Repo root the recipe targets (informational — handlers never touch the filesystem). */
  repo: string
  /** The catalog entry resolved for this gap (carries kind/expectedVerdict/ssot/rationale). */
  entry: CatalogEntry
}

/** The single handler interface — every category handler conforms to this. */
export type RemediationHandler = (gap: RemediationGap, ctx: RemediationContext) => RemediationPlan

/** Human-readable one-line summary of a gap's evidence (anchors the "real reason" on re-audit). */
function describeEvidence(gap: RemediationGap): string {
  const ev = gap.evidence
  if (!ev) return `${gap.id} (${gap.title}) — manual check, no code-verifiable evidence`
  const file = ev.file ?? '(unknown file)'
  const loc = ev.line !== undefined ? `:${ev.line}` : ''
  const detail = ev.detail ? ` — ${ev.detail}` : ''
  return `${gap.id} (${gap.title}) at ${file}${loc}${detail}`
}

/** Assemble a RemediationPlan from a handler's steps, sourcing kind/verdict/ssot from the entry. */
export function buildPlan(
  gap: RemediationGap,
  entry: CatalogEntry,
  steps: RemediationPlan['steps'],
): RemediationPlan {
  return {
    gapId: gap.id,
    kind: entry.kind,
    expectedVerdict: entry.expectedVerdict,
    code: entry.kind !== 'process',
    ssot: entry.ssot,
    evidence: describeEvidence(gap),
    steps,
  }
}
