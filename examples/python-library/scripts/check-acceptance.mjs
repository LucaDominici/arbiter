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
import { createHash } from 'node:crypto'
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, lstatSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  computeAcHash,
  parsePlanAnchor,
  validateAcFit,
  validateIssueAcceptanceCoverage,
} from './lib/acceptance-criteria.mjs'
import { enforceAcFitCitations } from './lib/agent-return-validate.mjs'
import { evidenceStaleness } from './lib/evidence-binding.mjs'
import { isMainModule, readRegularFileSync } from './lib/run-helpers.mjs'
import { inspectGateContract, unresolvedContractReasons } from './lib/gate-contract.mjs'

const PRE_PHASES = new Set(['preflight', 'plan', 'complete'])
const IMPL_PHASES = new Set(['red', 'green', 'refactor'])
const LATE_PHASES = new Set(['verification', 'close'])
const ADMISSION_GH_TIMEOUT_MS = 4000

// Upgraded brownfield targets can temporarily lack the derivation module. Keep that
// absence observable so plan admission can reject it with a repairable error.
const gateDerivationPath = join(import.meta.dirname, 'lib', 'gate-derivation.mjs')
const gateDerivation = existsSync(gateDerivationPath)
  ? await import(pathToFileURL(gateDerivationPath).href)
  : null

export function flagEnabled(root, env = process.env) {
  const override = env.ARBITER_ACCEPTANCE_ANCHOR
  if (override === '1' || override === 'true') return true
  if (override === '0' || override === 'false') return false
  try {
    const cfg = JSON.parse(readRegularFileSync(join(root, 'arbiter.json'), 'utf-8'))
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
    errors.push('plan "## Acceptance Criteria" has no `- AC-N: …` criterion bullet')
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
    return { body: readRegularFileSync(abs, 'utf-8') }
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
  const checkCurrent = args.includes('--check-derived-current')
  const derivedExit = checkPlanDerivedGates(root, plan.body, checkCurrent)
  if (derivedExit !== 0) return derivedExit
  if (checkCurrent && reportUnwiredPlanCheckers(root, plan.body) !== 0) return 1
  const fitExit = checkExplicitFitArg(root, args, result.criteriaIds)
  if (fitExit !== 0) return fitExit
  console.log('OK check-acceptance (--plan mode)')
  return 0
}

function admissionIssueNumber(args, admitIdx) {
  const raw = args[admitIdx + 1]
  const value = typeof raw === 'string' ? raw.replace(/^#/, '') : ''
  return /^\d+$/.test(value) ? String(Number(value)) : null
}

function readIssueForAdmission(root, issueNumber) {
  const result = spawnSync(
    'gh',
    ['issue', 'view', issueNumber, '--json', 'number,url,body,updatedAt'],
    {
      cwd: root,
      encoding: 'utf8',
      shell: false,
      timeout: ADMISSION_GH_TIMEOUT_MS,
      killSignal: 'SIGKILL',
    },
  )
  if (result.error || result.status !== 0 || result.signal) return null
  try {
    const issue = JSON.parse(result.stdout)
    if (!isValidAdmissionIssue(issue, issueNumber)) return null
    return issue
  } catch (err) {
    fail(
      `NO DATA: malformed gh response for issue #${issueNumber}: ${err instanceof Error ? err.message : String(err)}`,
    )
    return null
  }
}

function isValidAdmissionIssue(issue, issueNumber) {
  return (
    issue !== null &&
    typeof issue === 'object' &&
    issue.number === Number(issueNumber) &&
    typeof issue.url === 'string' &&
    issue.url.length > 0 &&
    typeof issue.body === 'string' &&
    issue.body.trim().length > 0 &&
    typeof issue.updatedAt === 'string' &&
    Number.isFinite(Date.parse(issue.updatedAt))
  )
}

function readAdmissionPlan(root, args, planIdx, admitIdx) {
  if (planIdx === -1) return { error: '--admit-issue requires --plan <path>' }
  const issueNumber = admissionIssueNumber(args, admitIdx)
  if (issueNumber === null) return { error: '--admit-issue requires a numeric issue number' }
  const planArg = args[planIdx + 1]
  if (!planArg) return { error: '--plan requires a path' }
  const plan = readPlan(root, planArg)
  return plan.error ? { error: plan.error } : { issueNumber, body: plan.body }
}

// Explicit admission is the sole networked mode. Ordinary gate and --plan checks stay offline.
function runAdmissionMode(root, args, planIdx, admitIdx) {
  const admission = readAdmissionPlan(root, args, planIdx, admitIdx)
  if (admission.error) {
    fail(admission.error)
    return 2
  }
  const { issueNumber, body } = admission
  const result = checkPlanAnchor(body)
  for (const error of result.errors) fail(error)
  if (!result.ok) return 1
  const issue = readIssueForAdmission(root, issueNumber)
  if (issue === null) {
    fail(`NO DATA: unable to read issue #${issueNumber} for plan admission`)
    return 2
  }
  const anchor = parsePlanAnchor(body)
  const errors = validateIssueAcceptanceCoverage(issueNumber, issue.body, anchor?.criteria ?? [])
  for (const error of errors) fail(error)
  if (errors.length > 0) return 1
  if (reportUnwiredPlanCheckers(root, body) !== 0) return 1
  const derivedExit = checkPlanDerivedGates(root, body)
  if (derivedExit !== 0) return derivedExit
  console.log(`OK check-acceptance (issue #${issueNumber} admitted)`)
  return 0
}

function checkPlanDerivedGates(root, planBody, forceCurrent = false) {
  const loaded = loadTaskState(root)
  if (loaded.exit !== undefined) return loaded.exit
  if (loaded.state.phase !== 'plan' && !forceCurrent) return 0
  if (gateDerivation === null) {
    fail('derived gate contract support is missing; restore scripts/lib/gate-derivation.mjs')
    return 1
  }
  const files = gateDerivation.parsePlanFilesManifest(planBody)
  if (files === null || files.length === 0) {
    fail('derived gates require a non-empty `files:` manifest in plan frontmatter')
    return 1
  }
  const contract = inspectGateContract(root)
  const unresolved = unresolvedContractReasons(contract)
  if (unresolved.length > 0) {
    fail(`derived gate contract is unresolved: ${unresolved.join('; ')}`)
    return 1
  }
  const verdict = gateDerivation.validateDerivedGates(
    files,
    loaded.state.derivedGates,
    undefined,
    contract,
  )
  if (!verdict.ok) {
    fail(
      'derived gates are missing or stale; re-anchor the plan with `arbiter lifecycle start --plan <path>`',
    )
    return 1
  }
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
  const errors = explicitFitErrors(root, fitAbs, criteriaIds)
  if (errors.length > 0) {
    for (const e of errors) fail(e)
    return 1
  }
  return 0
}

// #2850: when the named artifact IS the active task's fit (the verification transition), bind it
// exactly as gate mode does at landing — task id, branch, source content, plan hash, source
// envelope. A wave-integrate fit with no active task keeps the plan-only contract.
function activeTaskFitState(root, fitAbs) {
  if (!existsSync(join(root, '.claude', '.task', 'status.json'))) return null
  const loaded = loadTaskState(root)
  const state = loaded.state
  if (state === undefined || typeof state.taskId !== 'string' || typeof state.plan !== 'string')
    return null
  const taskFit = join(
    root,
    '.arbiter',
    'evidence',
    'ac-fit',
    `${sanitizeTaskId(state.taskId)}.json`,
  )
  return resolve(fitAbs) === resolve(taskFit) ? state : null
}

function explicitFitErrors(root, fitAbs, criteriaIds) {
  const state = activeTaskFitState(root, fitAbs)
  const fit = readValidatedFit(fitAbs, criteriaIds, true, state?.taskId, root)
  if (state === null || fit.errors.length > 0 || fit.json === undefined) return fit.errors
  return boundFitErrors(root, state, state.plan, fit.json)
}

// #2850 D7: a plan that promises `node scripts/check-*.mjs` makes a promise only something
// executable can keep. A checker that exists but is referenced by no tracked non-document file
// runs nowhere, so the promise is prose. Checkers the plan is about to create are exempt.
const PLAN_CHECKER_RE = /\bnode\s+(?:\.\/)?(scripts\/check-[A-Za-z0-9_-]+\.mjs)\b/g

export function unwiredPlanCheckers(root, planBody) {
  const paths = [...new Set([...planBody.matchAll(PLAN_CHECKER_RE)].map((m) => m[1]))]
  const errors = []
  for (const path of paths.filter((candidate) => existsSync(join(root, candidate)))) {
    const found = spawnSync(
      'git',
      ['grep', '-l', '-F', '-e', path, '--', '.', `:(exclude)${path}`, ':(exclude)*.md'],
      { cwd: root, encoding: 'utf8', shell: false },
    )
    if (found.status === 0) continue
    errors.push(
      found.status === 1
        ? `plan runs \`node ${path}\` but no executable file references it; wire it into a gate or test, or drop it from the plan`
        : `NO DATA: cannot verify that \`node ${path}\` is executed by anything (git grep failed)`,
    )
  }
  return errors
}

function reportUnwiredPlanCheckers(root, planBody) {
  const errors = unwiredPlanCheckers(root, planBody)
  for (const error of errors) fail(error)
  return errors.length === 0 ? 0 : 1
}

// Read record-shaped state from status.json; return { exit } when the gate should
// stop early (vacuous SKIP or fail-closed ERROR).
function loadTaskState(root) {
  const statusPath = join(root, '.claude', '.task', 'status.json')
  try {
    lstatSync(statusPath)
  } catch (err) {
    if (err?.code !== 'ENOENT') throw err
    console.log('SKIP check-acceptance: no active task')
    return { exit: 0 }
  }
  let state
  try {
    state = JSON.parse(readRegularFileSync(statusPath, 'utf-8'))
    if (state === null || typeof state !== 'object' || Array.isArray(state)) {
      throw new Error('task state must be an object')
    }
    // FAIL-OPEN-INTENT: malformed state is surfaced via fail() + exit 2 in this catch — the audit heuristic cannot see the returned {exit:2}.
  } catch {
    fail(
      'malformed .claude/.task/status.json — fix or reset it (rm -rf .claude/.task). ' +
        'Escape hatch: ARBITER_ACCEPTANCE_ANCHOR=0',
    )
    return { exit: 2 }
  }
  return { state }
}

function resolveTaskPhase(root) {
  const loaded = loadTaskState(root)
  if (loaded.exit !== undefined) return loaded
  const { state } = loaded
  // Mirror task-state.ts normalizePhase: absent/empty phase is a legal fresh state
  // (preflight), 'implementation' is the legacy alias for red.
  let phase = typeof state.phase === 'string' && state.phase !== '' ? state.phase : 'preflight'
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
      `phase ${phase} requires an anchored plan (arbiter lifecycle start --plan <path>). ` +
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
function currentGitIdentity(root) {
  try {
    const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
    const branch = execFileSync('git', ['branch', '--show-current'], {
      cwd: root,
      encoding: 'utf8',
    }).trim()
    return { sha, branch }
    // FAIL-OPEN-INTENT: Git identity failure is returned as a blocking fit error below.
  } catch {
    return null
  }
}

function fitSubjectErrors(root, state, json, identity) {
  const errors = []
  if (typeof state.branch !== 'string' || state.branch.length === 0)
    errors.push('ac-fit: active task branch binding is missing')
  if (!identity.branch || identity.branch !== state.branch)
    errors.push('ac-fit: current branch does not match active task')
  if (json.branch !== state.branch) errors.push('ac-fit: branch does not match active task')
  const staleness = evidenceStaleness(root, json.sha, { branch: state.branch })
  if (staleness !== null) errors.push(`ac-fit: ${staleness}`)
  return errors
}

// #2756: the roles record-agent-return admits as an acceptance-fit source (ac-fit and
// reviewer-panel modes). Producer and consumer must agree, or Ship's own review fails landing.
const FIT_SOURCE_ROLES = new Set(['reviewer', 'verifier'])

function sourceEnvelopeMismatch(envelope, state, json) {
  const expected = { schema: json.schema, taskId: json.taskId, criteria: json.criteria }
  return [
    envelope.taskId !== state.taskId,
    envelope.branch !== state.branch,
    envelope.sha !== json.sha,
    !FIT_SOURCE_ROLES.has(envelope.role),
    JSON.stringify(envelope.acceptanceFit) !== JSON.stringify(expected),
  ].some(Boolean)
}

function fitSourceErrors(root, state, json) {
  const source = json.sourceEnvelope
  if (typeof source?.path !== 'string' || typeof source?.sha256 !== 'string') {
    return ['ac-fit: source envelope binding is missing']
  }
  const sourcePath = resolve(root, source.path)
  if (sourcePath !== root && !sourcePath.startsWith(`${resolve(root)}${sep}`)) {
    return ['ac-fit: source envelope escapes the repository']
  }
  try {
    const raw = readRegularFileSync(sourcePath, 'utf8')
    if (createHash('sha256').update(raw).digest('hex') !== source.sha256) {
      return ['ac-fit: source envelope digest mismatch']
    }
    const envelope = JSON.parse(raw)
    const errors = enforceAcFitCitations(envelope.acceptanceFit, root, json.sha, source.path)
    if (sourceEnvelopeMismatch(envelope, state, json)) {
      errors.push('ac-fit: source envelope does not match the admitted fit')
    }
    return errors
    // FAIL-OPEN-INTENT: unreadable source evidence is accumulated as a blocking fit error.
  } catch {
    return ['ac-fit: source envelope is unreadable']
  }
}

function boundFitErrors(root, state, planRef, json) {
  const identity = currentGitIdentity(root)
  if (identity === null) return ['ac-fit: current Git identity is unavailable']
  const errors = fitSubjectErrors(root, state, json, identity)
  const plan = parsePlanAnchor(readRegularFileSync(join(root, planRef.split('#')[0]), 'utf8'))
  if (plan === null || json.planHash !== computeAcHash(plan.criteria))
    errors.push('ac-fit: plan hash does not match frozen acceptance criteria')
  errors.push(...fitSourceErrors(root, state, json))
  return errors
}

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
    const fit = readValidatedFit(fitPath, criteriaIds, late, state.taskId, root)
    const errors = fit.errors
    if (late && fit.errors.length === 0 && fit.json !== undefined)
      errors.push(...boundFitErrors(root, state, planRef, fit.json))
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
  const planIdx = args.indexOf('--plan')
  const admitIdx = args.indexOf('--admit-issue')

  // This must precede flag/phase SKIP: task admission is an explicit, networked operation.
  if (admitIdx !== -1) return runAdmissionMode(root, args, planIdx, admitIdx)

  if (!flagEnabled(root)) {
    console.log('SKIP check-acceptance: features.acceptanceAnchor is off')
    return 0
  }

  if (planIdx !== -1) return runPlanMode(root, args, planIdx)
  return runGateMode(root)
}

function readValidatedFit(absPath, criteriaIds, requireAllPass, expectedTaskId, root) {
  let json
  try {
    json = JSON.parse(readRegularFileSync(absPath, 'utf-8'))
    // FAIL-OPEN-INTENT: the parse error is surfaced as a returned error string; both callers print it and exit 1 — fail-closed at the call site.
  } catch {
    return { errors: [`ac-fit artifact is not valid JSON: ${absPath}`] }
  }
  const errors = validateAcFit(json, criteriaIds, { requireAllPass, expectedTaskId })
  if (root && errors.length === 0)
    errors.push(...enforceAcFitCitations(json, root, json.sha ?? 'HEAD', absPath))
  return { json, errors }
}

if (isMainModule(import.meta.url)) {
  try {
    process.exit(main())
  } catch (err) {
    console.error(`ERROR check-acceptance: ${err instanceof Error ? err.message : String(err)}`)
    process.exit(2)
  }
}
