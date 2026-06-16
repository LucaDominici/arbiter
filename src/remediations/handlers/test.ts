// SPDX-License-Identifier: Apache-2.0
// test/coverage remediation handler (#1422).
//
// A coverage/mutation/count gap (value or count_matches below the bar) is remediated by writing the
// genuinely-missing tests TDD-first, DELEGATING to the `tdd` skill (red→green→refactor). The recipe
// NEVER lowers a threshold and NEVER fakes a metric: the only honest close is more real, passing
// tests covering the uncovered behavior, so expectedVerdict is Y only after the real metric meets
// the bar.

import { buildPlan, type RemediationHandler } from './handler.js'

export const testHandler: RemediationHandler = (gap, ctx) => {
  const detail = gap.evidence?.detail ?? 'below the configured bar'
  return buildPlan(gap, ctx.entry, [
    {
      action: `Identify the uncovered behavior behind ${gap.id} (${gap.title}); evidence: ${detail}. Do NOT lower the threshold in ${ctx.entry.ssot.join(', ')} — that is fake-green.`,
    },
    {
      action: `Write the missing test(s) TDD-first (RED first, then minimal GREEN) for the uncovered behavior until the real metric meets the bar.`,
      delegateSkill: 'tdd',
    },
    {
      action: `Re-run \`arbiter gold-audit\` and confirm ${gap.id} flips to Y because the genuine metric improved — not because the bar moved.`,
      delegateCommand: 'npx arbiter gold-audit',
    },
  ])
}
