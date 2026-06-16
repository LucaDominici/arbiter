// SPDX-License-Identifier: Apache-2.0
// process (human-only) remediation handler (#1422).
//
// A `manual` check (engine verdict NV — code cannot verify it, excluded from the score denominator)
// has NO code recipe by construction. Its remediation is a real-world human action (e.g. a release
// engineer verifying a supply-chain attestation). The plan therefore carries NO delegateCommand and
// NO delegateSkill — only human-action steps — and expectedVerdict is NV: there is nothing code can
// flip. This is the structural anti-fake-green guarantee for manual checks.

import { buildPlan, type RemediationHandler } from './handler.js'

export const processHandler: RemediationHandler = (gap, ctx) => {
  return buildPlan(gap, ctx.entry, [
    {
      action: `${gap.id} (${gap.title}) is a MANUAL check (verdict NV) — code cannot verify it, so it has no automated recipe and is excluded from the score.`,
    },
    {
      action: `A human must perform + record the real-world action this check attests to, per the SSOT ${ctx.entry.ssot.join(', ')}${gap.anchor ? ` (anchor ${gap.anchor})` : ''}.`,
    },
    {
      action: `Capture durable evidence of the action (attestation log / signed record / reviewer sign-off). Do NOT attempt to make code "pass" a manual check — that would be fake-green.`,
    },
  ])
}
