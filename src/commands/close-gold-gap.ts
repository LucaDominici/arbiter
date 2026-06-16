// SPDX-License-Identifier: Apache-2.0
// `arbiter close-gold-gap <gapId>` — emit the remediation RECIPE for one gold-audit gap (#1422).
//
// Existing Code Survey (CANON-16): no remediation command existed in src/commands/. This is the LIVE
// consumer of src/remediations/ (catalog + handlers) — it avoids knip dead-code on the handlers and
// gives #1421 /levelup a working reference. It is THIN: it runs the gold-audit engine (reusing
// `runGoldAudit`, NOT a second engine), finds the requested gap, and prints the handler's recipe.
// It NEVER executes the recipe — anti-fake-green: a recipe is a plan a human/agent then carries out.

import { runGoldAudit } from './gold-audit.js'
import { planRemediation } from '../remediations/handlers/index.js'
import type { RemediationGap, RemediationPlan } from '../remediations/types.js'

export interface CloseGoldGapOptions {
  /** The gap id to remediate (e.g. `GA-DOC-03`). */
  gapId: string
  /** Repo to audit (default: current directory). */
  repo?: string
  /** Per-stack registry selector. */
  stack?: string
  /** Emit machine-readable JSON instead of the human recipe. */
  json?: boolean
}

export interface CloseGoldGapResult {
  exitCode: number
  plan: RemediationPlan | null
}

/** Render the human-readable recipe. */
function renderRecipe(plan: RemediationPlan): string {
  const lines: string[] = []
  const humanOnly = plan.code ? '' : ' (human-only, no code)'
  lines.push(
    `close-gold-gap ${plan.gapId}: ${plan.kind} recipe · expected verdict ${plan.expectedVerdict}${humanOnly}`,
  )
  lines.push(`  evidence: ${plan.evidence}`)
  lines.push(`  SSOT: ${plan.ssot.join(', ')}`)
  lines.push('  steps:')
  plan.steps.forEach((s, i) => {
    const delegate = s.delegateCommand
      ? ` [run: ${s.delegateCommand}]`
      : s.delegateSkill
        ? ` [skill: ${s.delegateSkill}]`
        : ''
    lines.push(`    ${i + 1}. ${s.action}${delegate}`)
  })
  return lines.join('\n') + '\n'
}

/**
 * Resolve the gap by id from a live gold-audit, then print its remediation recipe.
 * Returns the typed plan for callers/tests. Never executes the recipe.
 */
export function runCloseGoldGap(opts: CloseGoldGapOptions): CloseGoldGapResult {
  const audit = runGoldAudit({
    ...(opts.repo !== undefined ? { repo: opts.repo } : {}),
    ...(opts.stack !== undefined ? { stack: opts.stack } : {}),
    quiet: true, // consume the payload programmatically; our OWN output is the recipe
  })
  if (audit.payload === null) {
    process.stderr.write(
      `close-gold-gap: no audit payload (no registry, or the engine failed) — run \`arbiter init/update\` first.\n`,
    )
    return { exitCode: 1, plan: null }
  }

  // Recover the authoritative check `type` from the full checks list (the gap render drops it).
  const full = audit.payload.checks.find((c) => c.id === opts.gapId)
  if (full === undefined) {
    process.stderr.write(`close-gold-gap: gap "${opts.gapId}" not found in the audit.\n`)
    return { exitCode: 1, plan: null }
  }
  // Actionable: code gaps (N/P) OR a manual check (NV — human-only, routed to the process playbook).
  const verdict = full.verdict
  const actionable =
    verdict === 'N' || verdict === 'P' || (verdict === 'NV' && full.type === 'manual')
  if (!actionable) {
    process.stderr.write(
      `close-gold-gap: gap "${opts.gapId}" is verdict ${verdict}, not an actionable gap ` +
        `(only N/P code gaps and NV manual checks have recipes).\n`,
    )
    return { exitCode: 1, plan: null }
  }

  const gap: RemediationGap = {
    id: full.id,
    dimension: full.dimension,
    title: full.title,
    type: full.type as RemediationGap['type'],
    verdict,
    anchor: full.anchor,
    evidence: full.evidence,
  }

  const plan = planRemediation(gap, {
    ...(opts.repo !== undefined ? { repo: opts.repo } : {}),
  })

  if (opts.json) process.stdout.write(JSON.stringify(plan, null, 2) + '\n')
  else process.stdout.write(renderRecipe(plan))
  return { exitCode: 0, plan }
}
