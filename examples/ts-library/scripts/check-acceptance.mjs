#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// check-acceptance.mjs — INV-138 acceptance-criteria anchor gate.
//
// "Green" certifies mechanics; this gate anchors INTENT. During implementation phases
// the active task's plan MUST freeze the issue's acceptance criteria (explicit AC-N ids)
// plus non-goals; at verification/close the reviewer-written ac-fit artifact
// (.arbiter/evidence/ac-fit/<task>.json) MUST exist with every criterion PASS and a
// cited evidence line — the mechanical form of "unproven criterion = REJECT".
//
// Flag-gated (inert by default for targets): env ARBITER_ACCEPTANCE_ANCHOR=1/0 overrides
// arbiter.json features.acceptanceAnchor. Vacuous exit 0 with no active task, so main,
// CI on merged trees, and fresh clones stay green.
//
// Usage:
//   node scripts/check-acceptance.mjs                 # gate mode (active task state)
//   node scripts/check-acceptance.mjs --plan <path>   # direct plan validation (wave integrate)
//     [--ac-fit <path>]                               # validate a specific ac-fit artifact
//
// Exit codes (INV-53): 0 PASS/SKIP · 1 FAIL (anchor or fit missing/invalid) · 2 ERROR
//
// CATALOG: enforces the acceptance-criteria anchor (INV-138) — implementation-phase plans must freeze explicit AC-N criteria + non-goals, and verification/close requires an all-PASS per-criterion ac-fit evidence artifact.
// CATALOG: rejected fold-in into check-phase-doc-consistency.mjs because that gate validates the SHAPE of .claude/.task/status.json (single-doc split-brain), while this one validates the CONTENT CONTRACT between the anchored plan, the issue's acceptance criteria, and reviewer fit evidence — a different SSOT axis with a feature-flag lifecycle.
// CATALOG: rejected fold-in into check-evidence-bundle.mjs because evidence bundles are per-task artifact BUNDLES under .evidence/ with their own JSON schema file, whereas ac-fit is a single per-criterion verdict artifact coupled to plan parsing (scripts/lib/acceptance-criteria.mjs) that bundle validation knows nothing about.
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { parsePlanAnchor, validateAcFit } from './lib/acceptance-criteria.mjs'
import { isMainModule } from './lib/run-helpers.mjs'

const PRE_PHASES = new Set(['preflight', 'plan', 'red-team-review', 'red-team-rework', 'complete'])
const IMPL_PHASES = new Set(['red', 'green', 'refactor'])
const LATE_PHASES = new Set(['verification', 'close'])

export function flagEnabled(root, env = process.env) {
  const override = env.ARBITER_ACCEPTANCE_ANCHOR
  if (override === '1' || override === 'true') return true
  if (override === '0' || override === 'false') return false
  try {
    const cfg = JSON.parse(readFileSync(join(root, 'arbiter.json'), 'utf-8'))
    return cfg?.features?.acceptanceAnchor === true
    // FAIL-OPEN-INTENT: unreadable/absent arbiter.json means an ungoverned tree — the flag-gated feature stays inert by design (mirrors guard-done-evidence.mjs).
  } catch {
    return false // inert when no readable arbiter.json (ungoverned tree)
  }
}

export function sanitizeTaskId(taskId) {
  return String(taskId ?? 'unknown').replace(/[^A-Za-z0-9._-]/g, '')
}

function fail(msg) {
  process.stderr.write(`FAIL check-acceptance: ${msg}\n`)
}

/** Validate one plan body's anchor; returns { ok, criteriaIds, errors }. */
export function checkPlanAnchor(planBody) {
  const anchor = parsePlanAnchor(planBody)
  const errors = []
  if (anchor === null) {
    errors.push(
      'plan lacks the frozen anchor: add "## Acceptance Criteria" (verbatim from the issue, explicit AC-N ids) and "## Non-Goals"',
    )
    return { ok: false, criteriaIds: [], errors }
  }
  if (anchor.criteria.length === 0) {
    errors.push('plan "## Acceptance Criteria" has no `- [ ] AC-N: …` checkbox')
  } else if (anchor.criteria.some((c) => !c.explicit)) {
    errors.push('plan acceptance criteria need explicit stable `AC-N:` ids')
  } else {
    // Duplicate ids collapse distinct criteria into one fit verdict (fail-open) —
    // wave plans must namespace per issue: AC-<issue>.<n> (e.g. AC-123.1).
    const ids = anchor.criteria.map((c) => c.id)
    const dupes = [...new Set(ids.filter((id, i) => ids.indexOf(id) !== i))]
    if (dupes.length > 0)
      errors.push(
        `duplicate criterion id(s) in the anchor: ${dupes.join(', ')} — namespace wave criteria as AC-<issue>.<n>`,
      )
  }
  if (anchor.nonGoals.length === 0) errors.push('plan lacks a non-empty "## Non-Goals" section')
  return {
    ok: errors.length === 0,
    criteriaIds: anchor.criteria.map((c) => c.id),
    errors,
  }
}

function readPlan(root, planRef) {
  const withoutFragment = planRef.split('#')[0]
  const abs = withoutFragment.startsWith('/') ? withoutFragment : join(root, withoutFragment)
  if (!existsSync(abs)) return { error: `anchored plan file not found: ${withoutFragment}` }
  try {
    return { body: readFileSync(abs, 'utf-8') }
    // FAIL-OPEN-INTENT: the error object is returned and every caller surfaces it via fail() + exit 2 — fail-closed at the call site, not here.
  } catch (err) {
    return {
      error: `anchored plan unreadable: ${err instanceof Error ? err.message : String(err)}`,
    }
  }
}

// ── direct --plan mode (wave integrate: no per-task status.json in the main tree) ──
function runPlanMode(root, args, planIdx) {
  const planArg = args[planIdx + 1]
  if (!planArg) {
    fail('--plan requires a path')
    return 2
  }
  const plan = readPlan(root, planArg)
  if (plan.error) {
    fail(plan.error)
    return 2
  }
  const result = checkPlanAnchor(plan.body)
  for (const e of result.errors) fail(e)
  if (!result.ok) return 1
  const fitExit = checkExplicitFitArg(root, args, result.criteriaIds)
  if (fitExit !== 0) return fitExit
  console.log('OK check-acceptance (--plan mode)')
  return 0
}

// --ac-fit <path>: validate a named artifact against the plan's criteria (all-PASS).
function checkExplicitFitArg(root, args, criteriaIds) {
  const fitIdx = args.indexOf('--ac-fit')
  if (fitIdx === -1) return 0
  const fitArg = args[fitIdx + 1]
  const fitAbs = fitArg && (fitArg.startsWith('/') ? fitArg : join(root, fitArg))
  if (!fitAbs || !existsSync(fitAbs)) {
    fail(`--ac-fit artifact not found: ${fitArg}`)
    return 2
  }
  const errors = validateFitFile(fitAbs, criteriaIds, true)
  if (errors.length > 0) {
    for (const e of errors) fail(e)
    return 1
  }
  return 0
}

// Resolve {state, phase} from status.json; returns { exit } when the gate should
// stop early (vacuous SKIP or fail-closed ERROR).
function resolveTaskPhase(root) {
  const statusPath = join(root, '.claude', '.task', 'status.json')
  if (!existsSync(statusPath)) {
    console.log('SKIP check-acceptance: no active task')
    return { exit: 0 }
  }
  let state
  try {
    state = JSON.parse(readFileSync(statusPath, 'utf-8'))
    // FAIL-OPEN-INTENT: malformed state is surfaced via fail() + exit 2 in this catch — the audit heuristic cannot see the returned {exit:2}.
  } catch {
    fail(
      'malformed .claude/.task/status.json — fix or reset it (rm -rf .claude/.task). ' +
        'Escape hatch: ARBITER_ACCEPTANCE_ANCHOR=0',
    )
    return { exit: 2 }
  }
  // Mirror task-state.ts normalizePhase: absent/empty phase is a legal fresh state
  // (preflight), 'implementation' is the legacy alias for red.
  let phase = typeof state?.phase === 'string' && state.phase !== '' ? state.phase : 'preflight'
  if (phase === 'implementation') phase = 'red'
  if (PRE_PHASES.has(phase)) {
    console.log(`SKIP check-acceptance: phase ${phase} precedes the anchor contract`)
    return { exit: 0 }
  }
  if (!IMPL_PHASES.has(phase) && !LATE_PHASES.has(phase)) {
    fail(
      `unrecognized task phase "${phase}" — reset stale state (rm -rf .claude/.task) or fix status.json. ` +
        'Escape hatch: ARBITER_ACCEPTANCE_ANCHOR=0',
    )
    return { exit: 2 }
  }
  return { state, phase }
}

// Resolve the anchored plan for gate mode; { exit } on fail-closed ERROR / anchor FAIL.
function resolveGatePlan(root, state, phase) {
  const planField = state === null || typeof state !== 'object' ? undefined : state.plan
  const planRef = typeof planField === 'string' && planField !== 'unknown' ? planField : null
  if (!planRef) {
    fail(
      `phase ${phase} requires an anchored plan (arbiter task init --plan <path>). ` +
        'Escape hatch: ARBITER_ACCEPTANCE_ANCHOR=0',
    )
    return { exit: 2 }
  }
  const plan = readPlan(root, planRef)
  if (plan.error) {
    fail(
      `${plan.error} — reset stale state (rm -rf .claude/.task) or restore the plan. Escape hatch: ARBITER_ACCEPTANCE_ANCHOR=0`,
    )
    return { exit: 2 }
  }
  const result = checkPlanAnchor(plan.body)
  if (!result.ok) {
    for (const e of result.errors) fail(e)
    return { exit: 1 }
  }
  return { planRef, criteriaIds: result.criteriaIds }
}

// Per-task ac-fit contract: validate when present; REQUIRED (all-PASS) at late phases,
// except for wave workers — a task anchored to `wave-N.md#group` never produces a
// per-worker ac-fit; the wave's fit enforcement runs at integrate time
// (`--plan … --ac-fit wave-N.json` in the main tree, see wave-drain Phase 4).
function checkTaskFit(root, state, phase, planRef, criteriaIds) {
  const fitPath = join(
    root,
    '.arbiter',
    'evidence',
    'ac-fit',
    `${sanitizeTaskId(state.taskId)}.json`,
  )
  const isWaveWorker = planRef.includes('#')
  const late = LATE_PHASES.has(phase)
  if (existsSync(fitPath)) {
    const errors = validateFitFile(fitPath, criteriaIds, late, state.taskId)
    if (errors.length > 0) {
      for (const e of errors) fail(e)
      return 1
    }
    return 0
  }
  if (late && !isWaveWorker) {
    fail(
      `phase ${phase} requires the ac-fit evidence artifact at ${fitPath} ` +
        '(reviewer: per-criterion verdicts with cited diff/test lines — see /ship Adversarial Verifier; ' +
        `note the sanitized filename: taskId "#42" → 42.json)`,
    )
    return 1
  }
  return 0
}

// ── gate mode: driven by the active task state ──
function runGateMode(root) {
  const resolved = resolveTaskPhase(root)
  if (resolved.exit !== undefined) return resolved.exit
  const { state, phase } = resolved

  const planResolved = resolveGatePlan(root, state, phase)
  if (planResolved.exit !== undefined) return planResolved.exit
  const { planRef, criteriaIds } = planResolved

  const fitExit = checkTaskFit(root, state, phase, planRef, criteriaIds)
  if (fitExit !== 0) return fitExit

  console.log(`OK check-acceptance (phase ${phase}, ${criteriaIds.length} criteria)`)
  return 0
}

function main() {
  const root = process.cwd()
  const args = process.argv.slice(2)

  if (!flagEnabled(root)) {
    console.log('SKIP check-acceptance: features.acceptanceAnchor is off')
    return 0
  }

  const planIdx = args.indexOf('--plan')
  if (planIdx !== -1) return runPlanMode(root, args, planIdx)
  return runGateMode(root)
}

function validateFitFile(absPath, criteriaIds, requireAllPass, expectedTaskId) {
  let json
  try {
    json = JSON.parse(readFileSync(absPath, 'utf-8'))
    // FAIL-OPEN-INTENT: the parse error is surfaced as a returned error string; both callers print it and exit 1 — fail-closed at the call site.
  } catch {
    return [`ac-fit artifact is not valid JSON: ${absPath}`]
  }
  return validateAcFit(json, criteriaIds, { requireAllPass, expectedTaskId })
}

if (isMainModule(import.meta.url)) {
  try {
    process.exit(main())
  } catch (err) {
    console.error(`ERROR check-acceptance: ${err instanceof Error ? err.message : String(err)}`)
    process.exit(2)
  }
}
