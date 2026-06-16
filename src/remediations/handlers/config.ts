// SPDX-License-Identifier: Apache-2.0
// config remediation handler (#1422).
//
// A missing wired-tool declaration / required marker (file_contains N, or a lint metric over the
// bar) is remediated by ADDING the real config or fixing the real violation at the root cause. The
// recipe explicitly REFUSES marker-stuffing (writing the matched literal with no behavior behind it)
// and REFUSES suppression (eslint-disable / --no-verify / skip): the only honest close is genuine
// wiring, so expectedVerdict is Y once the tool actually runs / the violations are fixed.

import { buildPlan, type RemediationHandler } from './handler.js'

export const configHandler: RemediationHandler = (gap, ctx) => {
  const detail = gap.evidence?.detail ?? 'the required declaration is absent'
  const file = gap.evidence?.file ?? 'the target config'
  return buildPlan(gap, ctx.entry, [
    {
      action: `Read ${gap.id} (${gap.title}) and the SSOT ${ctx.entry.ssot.join(', ')} to learn what the check actually requires; evidence: ${detail}.`,
    },
    {
      action: `Wire the real tool/config in "${file}" so the behavior the check verifies genuinely runs — do NOT write the matched literal alone (marker-stuffing) and do NOT suppress the check.`,
    },
    {
      action: `Re-run \`arbiter gold-audit\` and confirm ${gap.id} flips to Y because the tool is genuinely wired (e.g. the declared script actually executes), not because a string was pasted in.`,
      delegateCommand: 'npx arbiter gold-audit',
    },
  ])
}
