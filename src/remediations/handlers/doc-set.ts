// SPDX-License-Identifier: Apache-2.0
// doc-set remediation handler (#1422).
//
// A missing canonical doc (file_exists N) is remediated by DELEGATING to the existing scaffolder
// `node scripts/check-doc-set.mjs --generate` (writes "STUB — fill me in.") — but a stub only
// proves PRESENCE, which is fake-green. So the recipe ALWAYS chains scaffold → fill-with-real-content
// and the plan's expectedVerdict is P (NOT Y): the check is genuinely closed only when a human/agent
// replaces the stub. Presence is never claimed as closure.

import { buildPlan, type RemediationHandler } from './handler.js'

export const docSetHandler: RemediationHandler = (gap, ctx) => {
  const file = gap.evidence?.file ?? '(the missing doc)'
  return buildPlan(gap, ctx.entry, [
    {
      action: `Scaffold the missing doc "${file}" from the canonical doc-set manifest. This writes a STUB (presence only), which is NOT closure.`,
      delegateCommand: 'node scripts/check-doc-set.mjs --generate',
    },
    {
      action: `Replace the "STUB — fill me in." placeholder in "${file}" with real, hand-written content that satisfies ${gap.id} (${gap.title}). Cite the SSOT ${ctx.entry.ssot.join(', ')}.`,
    },
    {
      action: `Re-run \`arbiter gold-audit\` and confirm ${gap.id} only flips to Y once real content exists — a bare stub must keep the check at N/P (presence ≠ closure).`,
      delegateCommand: 'npx arbiter gold-audit',
    },
  ])
}
