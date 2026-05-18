// SPDX-License-Identifier: Apache-2.0
import type { CostReport } from './recorder.js'

export interface BudgetResult {
  ok: boolean
  reason?: string
}

const DEFAULT_IMPL_BUDGET_TOKENS = 50_000

export function assertImplBudget(
  report: CostReport,
  threshold = DEFAULT_IMPL_BUDGET_TOKENS,
): BudgetResult {
  const phases = Object.keys(report.byPhase)
  if (phases.length === 0) {
    return { ok: true, reason: 'warn: no samples — transcript unavailable, skipping budget check' }
  }

  const firstPhaseName = phases[0] ?? ''
  const firstPhase = report.byPhase[firstPhaseName]
  if (firstPhase === undefined) {
    return {
      ok: true,
      reason: 'warn: no phase data — transcript unavailable, skipping budget check',
    }
  }

  if (firstPhase.samples === 0) {
    return {
      ok: true,
      reason: 'warn: no transcript samples available — budget check skipped (absence of evidence)',
    }
  }

  if (firstPhase.in > threshold) {
    return {
      ok: false,
      reason: `budget breach: first-phase input tokens ${firstPhase.in} exceeds threshold ${threshold}. Context not clean post-/clear. Use ARBITER_COST_BUDGET_SKIP=1 to override with a reason.`,
    }
  }

  return { ok: true }
}
