// SPDX-License-Identifier: Apache-2.0
/**
 * `arbiter review diff` command (#262).
 *
 * Compares two graph snapshots (base vs head) and emits a semantic diff:
 *   - Enforcement changes per INV (strengthened / weakened)
 *   - Removed test provers (flag if last prover for an INV is removed)
 *   - Implicit ADR supersession (removed code that lived under an ADR)
 *
 * Recommendation: PASS if no weakening detected, BLOCK otherwise.
 *
 * CANON-16 Existing Code Survey:
 *   - Grepped src/review/ for diff comparison functions. Found review/tier-constants.ts,
 *     review/rubric.ts (code review rubric). No snapshot comparison found.
 *   - Grepped src/commands/ for "diff" — found commands/diff.ts (config diff, unrelated).
 *   - New file justified as `review-diff.ts` to avoid collision with config diff.
 */

import { storeFromSnapshot } from '../graph/store.js'
import type { GraphSnapshot } from '../graph/model.js'
import type { GraphStore } from '../graph/store.js'

interface EnforcementChange {
  inv: string
  direction: 'strengthened' | 'weakened'
  added: string[]
  removed: string[]
}

interface AdrSupersession {
  adr: string
  removedImplementors: string[]
}

interface SemanticDiffChanges {
  enforcement_changes: EnforcementChange[]
  /** INV ids whose last prover test was removed */
  removed_provers: string[]
  adr_supersessions: AdrSupersession[]
}

export interface ReviewDiffResult {
  status: 'ok' | 'error'
  exitCode: 0 | 2
  recommendation: 'PASS' | 'BLOCK'
  risk_delta: 'increased' | 'decreased' | 'unchanged'
  changes: SemanticDiffChanges
  summary: string
  reason?: string
}

export interface ReviewDiffOptions {
  base: GraphSnapshot
  head: GraphSnapshot
}

export function runReviewDiff(opts: ReviewDiffOptions): ReviewDiffResult {
  const baseStore = storeFromSnapshot(opts.base)
  const headStore = storeFromSnapshot(opts.head)

  const enforcementChanges = diffEnforcement(baseStore, headStore)
  const removedProvers = diffProvers(baseStore, headStore)
  const adrSupersessions = diffAdrSupersessions(baseStore, headStore)

  const hasWeakening = enforcementChanges.some((c) => c.direction === 'weakened')
  const hasLostProvers = removedProvers.length > 0
  const block = hasWeakening || hasLostProvers

  const recommendation: 'PASS' | 'BLOCK' = block ? 'BLOCK' : 'PASS'

  const riskDelta: 'increased' | 'decreased' | 'unchanged' =
    hasWeakening || hasLostProvers
      ? 'increased'
      : enforcementChanges.some((c) => c.direction === 'strengthened')
        ? 'decreased'
        : 'unchanged'

  const lines: string[] = []
  if (enforcementChanges.length > 0) {
    lines.push(`Enforcement changes: ${enforcementChanges.length}`)
    for (const c of enforcementChanges) {
      lines.push(
        `  ${c.inv}: ${c.direction} (${c.added.length} added, ${c.removed.length} removed)`,
      )
    }
  }
  if (removedProvers.length > 0) {
    lines.push(`Removed last provers: ${removedProvers.join(', ')}`)
  }
  if (adrSupersessions.length > 0) {
    lines.push(`ADR supersessions: ${adrSupersessions.map((s) => s.adr).join(', ')}`)
  }
  if (lines.length === 0) lines.push('No semantic changes detected.')

  const summary = `[${recommendation}] ${lines[0]}`

  return {
    // #1647: this is a governance GATE, not an advisory report. When an INV's
    // enforcement is weakened or its last prover removed, `block` is true and the
    // command MUST exit non-zero so any CI/`/ship` step gating on the exit code
    // actually fails. Hardcoding `0` here made the gate fail-open (BLOCK printed,
    // exit 0). `2` matches the declared `exitCode: 0 | 2` union.
    status: 'ok',
    exitCode: block ? 2 : 0,
    recommendation,
    risk_delta: riskDelta,
    changes: {
      enforcement_changes: enforcementChanges,
      removed_provers: removedProvers,
      adr_supersessions: adrSupersessions,
    },
    summary,
  }
}

// ── diff helpers ─────────────────────────────────────────────────────────────

function diffEnforcement(base: GraphStore, head: GraphStore): EnforcementChange[] {
  const changes: EnforcementChange[] = []

  // Check all INV nodes that exist in either snapshot
  const allInvIds = new Set<string>([
    ...base.nodesByKind('INV').map((n) => n.id),
    ...head.nodesByKind('INV').map((n) => n.id),
  ])

  for (const invId of allInvIds) {
    const baseGates = new Set(base.outgoing(invId, 'enforces').map((e) => e.to))
    const headGates = new Set(head.outgoing(invId, 'enforces').map((e) => e.to))

    const added = [...headGates].filter((g) => !baseGates.has(g))
    const removed = [...baseGates].filter((g) => !headGates.has(g))

    if (added.length === 0 && removed.length === 0) continue

    // #1647: fail-safe — ANY removed enforcer counts as weakening, including a
    // net-neutral 1-for-1 swap (remove INV-04's sole gate, add a different,
    // possibly weaker or no-op gate). The old `removed.length > added.length`
    // tie-broke a {A}->{B} swap to `strengthened`, letting an enforcement
    // substitution pass GREEN unreviewed. A swap is treated as weakened until the
    // replacement is proven equivalent.
    const direction: 'strengthened' | 'weakened' = removed.length > 0 ? 'weakened' : 'strengthened'

    changes.push({ inv: invId, direction, added, removed })
  }

  return changes
}

function diffProvers(base: GraphStore, head: GraphStore): string[] {
  const removedLastProverInvs: string[] = []

  for (const inv of base.nodesByKind('INV')) {
    const baseProvers = base.incoming(inv.id, 'proves')
    if (baseProvers.length === 0) continue // No provers in base — not a regression

    const headProvers = head.incoming(inv.id, 'proves')
    if (headProvers.length === 0) {
      // All provers were removed
      removedLastProverInvs.push(inv.id)
    }
  }

  return removedLastProverInvs.sort()
}

function diffAdrSupersessions(base: GraphStore, head: GraphStore): AdrSupersession[] {
  const supersessions: AdrSupersession[] = []

  for (const adr of base.nodesByKind('ADR')) {
    const baseImplementors = base.incoming(adr.id, 'implements').map((e) => e.from)
    if (baseImplementors.length === 0) continue

    const headImplementors = new Set(head.incoming(adr.id, 'implements').map((e) => e.from))

    const removed = baseImplementors.filter((id) => !headImplementors.has(id))
    if (removed.length > 0) {
      supersessions.push({ adr: adr.id, removedImplementors: removed })
    }
  }

  return supersessions
}

/**
 * Render the diff result as a markdown PR comment.
 */
export function renderMarkdown(result: ReviewDiffResult): string {
  const icon = result.recommendation === 'PASS' ? 'PASS' : 'BLOCK'
  const lines: string[] = [
    `## Semantic Review: ${icon}`,
    '',
    `**Risk delta:** ${result.risk_delta}`,
    `**Recommendation:** ${result.recommendation}`,
    '',
  ]

  const { enforcement_changes, removed_provers, adr_supersessions } = result.changes

  if (enforcement_changes.length > 0) {
    lines.push('### Enforcement Changes')
    for (const c of enforcement_changes) {
      const dir = c.direction === 'weakened' ? 'WEAKENED' : 'strengthened'
      lines.push(`- **${c.inv}**: ${dir}`)
      if (c.added.length > 0) lines.push(`  - Added: ${c.added.join(', ')}`)
      if (c.removed.length > 0) lines.push(`  - Removed: ${c.removed.join(', ')}`)
    }
    lines.push('')
  }

  if (removed_provers.length > 0) {
    lines.push('### Removed Provers (BLOCK)')
    for (const inv of removed_provers) {
      lines.push(`- **${inv}**: last test prover removed`)
    }
    lines.push('')
  }

  if (adr_supersessions.length > 0) {
    lines.push('### Implicit ADR Supersessions')
    for (const s of adr_supersessions) {
      lines.push(`- **${s.adr}**: implementors removed: ${s.removedImplementors.join(', ')}`)
    }
    lines.push('')
  }

  if (
    enforcement_changes.length === 0 &&
    removed_provers.length === 0 &&
    adr_supersessions.length === 0
  ) {
    lines.push('No semantic changes detected.')
  }

  return lines.join('\n')
}
