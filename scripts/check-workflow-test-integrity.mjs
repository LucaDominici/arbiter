#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// arbiter — workflow test integrity checker (INV-89)
// Validates that workflow files do not have syntax issues or missing required fields.
// Exits 0 when all workflows pass integrity checks; exits 1 when issues found.
// Part of the anti-drift validator family (W6).
//
// Usage: node scripts/check-workflow-test-integrity.mjs [--dir <path>] [--help]

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { parse as parseYaml } from 'yaml'

import { collectYamlFiles, parseHelpAndDir } from './lib/workflow-scan.mjs'

const args = process.argv.slice(2)
const { cwd: CWD } = parseHelpAndDir(args, {
  usage: [
    'Usage: node scripts/check-workflow-test-integrity.mjs [options]',
    '',
    'Validates workflow file integrity: required fields, non-empty jobs, no continue-on-error on test steps.',
    'Exits 0 when all workflows pass; exits 1 when issues found.',
    '',
    'Options:',
    '  --dir <path>    Root directory to scan (default: cwd)',
    '  --help, -h      Show this help and exit',
    '',
  ].join('\n'),
})

const WORKFLOWS_DIR = join(CWD, '.github', 'workflows')

// Informational-only workflows where continue-on-error is acceptable at job level
// `notify` covers _notify.yml (issue comments) and _post-merge-notify.yml (CODEOWNERS email)
const INFORMATIONAL_PATTERNS = ['heartbeat', 'nightly', 'weekly', 'monthly', 'notify']

// #1319.3 (INV-80): STEP-SCOPED allowlist. drift-shadow.yml is NOT a file-wide
// informational workflow — only its specific `parity` step is permitted a
// continue-on-error (the local/CI parity comparison must not fail the nightly run;
// a mismatch instead opens a drift issue). Any OTHER continue-on-error step in
// drift-shadow.yml still FAILS.
const STEP_SCOPED_ALLOWLIST = {
  'drift-shadow.yml': new Set(['parity']),
  // #2058: these two steps upload SUPPLEMENTARY artifacts (JUnit output, the
  // gate's own --json result) — never a test or build step itself. Both run
  // AFTER the real signal (the test/gate run above) already succeeded or
  // failed on its own terms; an Artifacts-quota hiccup on the upload must not
  // retroactively fail a job whose actual work already completed correctly.
  '01-pr-fast.yml': new Set(['upload-test-results', 'upload-gate-result']),
}

// #1491 — fake-green-via-`|| true`: a gate/test/check command whose exit code is swallowed by a
// trailing `|| true` / `|| exit 0` / `|| :` turns a red gate green. This is distinct from the
// many LEGITIMATE `|| true` uses in CI (best-effort cleanup `find … -delete || true`, capture
// `LOG=$(git log … || true)`, `grep … || true`, `cp … 2>/dev/null || true`) — so the guard flags
// `|| true` ONLY when the same line invokes a recognized GATE command. Conservative by design:
// false-negatives (a novel gate runner) are preferable to false-positives on cleanup idioms.
const GATE_COMMAND_RE =
  /\b(?:check-all(?:\.mjs)?|scripts\/check-[\w.-]+\.mjs|arbiter\s+(?:verify|gold-audit|anti-fake-green)|npm\s+(?:run\s+)?test|npm\s+run\s+(?:lint|gate|check[\w:-]*)|npx\s+(?:vitest|jest|eslint|tsc|playwright)\b|pnpm\s+(?:run\s+)?test|yarn\s+test|vitest\b|jest\b|pytest\b|cargo\s+(?:test|clippy)|go\s+test\b|(?:\.\/)?gradlew\s+\w*(?:test|check|verify)|mvn\s+\w*(?:test|verify))\b/
// Swallow patterns that neutralize a non-zero exit at end-of-command.
const EXIT_SWALLOW_RE = /\|\|\s*(?:true|exit\s+0|:)\s*(?:#.*)?$/

// Resolve the id: of the step enclosing line index `i`. A step begins at a
// `- ` list item (8-space indent) and runs until the next one. Returns the
// step's `id:` value, or null when the step has no id.
function enclosingStepId(lines, i) {
  let stepId = null
  for (let j = i; j >= 0; j--) {
    const line = lines[j]
    const idMatch = /^\s{8,}id:\s*(\S+)/.exec(line)
    if (idMatch && stepId === null) stepId = idMatch[1]
    if (/^\s{6}-\s/.test(line)) return stepId // step boundary reached
  }
  return stepId
}

// #2476 — a base-branch filter on a `pull_request` trigger is a fail-open BY NO-RUN.
//
// On a `pull_request` event, `branches:` filters the BASE branch, not the head. A
// merge-gate workflow declaring `branches: [main]` therefore matches NOTHING for a
// pull request based on a task or train branch, and GitHub creates no workflow run
// at all. That is strictly worse than a red check: the pull request displays no
// FAILING checks because it has no checks, so every human or automated
// "no failing checks ⇒ mergeable" read is satisfied by a pull request that was
// never tested. Branch protection is no backstop — protection is configured on the
// BASE branch, and a task or train branch carries none, so nothing is required
// there. Stacked pull requests are an in-use practice in this repo (the cloud
// handover runbooks describe merge trains where each row bases on the row above),
// so coverage was decided by merge order rather than by the gate.
//
// The rule: run creation must be UNCONDITIONAL on the base branch. Any per-branch
// economy belongs INSIDE the workflow, in a job-level `if:`, where a skipped job
// still reports a result the aggregator can read. `branches-ignore` is rejected for
// the same reason — it is an allowlist by omission, and a base a future convention
// invents would silently stop being tested.
//
// SCOPE — a workflow that carries a MERGE-GATE AGGREGATOR job (a job id ending in
// `-required`; this project's documented required-status-check convention, see
// docs/internal/architecture/ARCHITECTURE.md). Those are the workflows whose absence
// is read as "CI is green". Supplementary, path-scoped lanes (CodeQL, the frontend
// lane, contract smoke tests) carry no aggregator, are not read that way, and are
// deliberately left to their own economics.
const PR_TRIGGER_EVENTS = ['pull_request', 'pull_request_target']
const BASE_FILTER_KEYS = ['branches', 'branches-ignore']

/** True when the workflow declares a merge-gate aggregator job (`*-required`). */
function hasMergeGateAggregator(doc) {
  const jobs = doc?.jobs
  if (!jobs || typeof jobs !== 'object') return false
  return Object.keys(jobs).some((id) => id.endsWith('-required'))
}

/** Parse a workflow; null when it is not a YAML mapping (a different defect, owned elsewhere). */
function parseWorkflow(content) {
  let doc
  try {
    doc = parseYaml(content)
  } catch {
    return null
  }
  return doc && typeof doc === 'object' ? doc : null
}

/**
 * The workflow's `on:` trigger mapping, or null when absent/scalar/sequence.
 * A YAML 1.1 loader folds the bare key `on` to boolean true; `yaml`@2 (YAML 1.2
 * core schema) keeps it a string. Accept both so the rule cannot be dodged by a
 * parser swap.
 */
function triggerMap(doc) {
  const on = doc.on ?? doc[true]
  return on && typeof on === 'object' && !Array.isArray(on) ? on : null
}

/** Base-branch filter keys declared on one trigger's config, qualified by event name. */
function baseFilterKeys(event, cfg) {
  if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) return []
  return BASE_FILTER_KEYS.filter((key) => cfg[key] !== undefined && cfg[key] !== null).map(
    (key) => `${event}.${key}`,
  )
}

/**
 * Base-branch filter keys declared on a merge-gate workflow's pull_request trigger(s).
 * Returns [] for a workflow that declares none or that is not a merge gate.
 */
function prBaseBranchFilters(content) {
  const doc = parseWorkflow(content)
  if (!doc || !hasMergeGateAggregator(doc)) return []
  const on = triggerMap(doc)
  if (!on) return []
  return PR_TRIGGER_EVENTS.flatMap((event) => baseFilterKeys(event, on[event]))
}

const yamlFiles = collectYamlFiles(WORKFLOWS_DIR)
let violations = 0

for (const file of yamlFiles) {
  let content
  try {
    content = readFileSync(file, 'utf-8')
  } catch {
    continue
  }

  const fileName = file.split('/').pop() ?? ''
  const isInformational = INFORMATIONAL_PATTERNS.some((p) => fileName.includes(p))

  // Check: must have 'on:' trigger
  if (!content.includes('\non:') && !content.startsWith('on:')) {
    process.stderr.write(`[FAIL] ${file}: missing 'on:' trigger section\n`)
    violations++
  }

  // Check: must have 'jobs:' section
  if (!content.includes('\njobs:') && !content.startsWith('jobs:')) {
    process.stderr.write(`[FAIL] ${file}: missing 'jobs:' section\n`)
    violations++
  }

  // Check: continue-on-error on step level in non-informational workflows (INV-80)
  if (!isInformational) {
    const allowedSteps = STEP_SCOPED_ALLOWLIST[fileName]
    const lines = content.split('\n')
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      if (/^\s{6,}continue-on-error:\s*true/.test(line)) {
        // Step-scoped allowlist: permit only the named step(s) for this file.
        if (allowedSteps && allowedSteps.has(enclosingStepId(lines, i))) continue
        process.stderr.write(
          `[FAIL] ${file}:${i + 1}: step-level continue-on-error: true found (INV-80)\n`,
        )
        violations++
      }
    }
  }

  // Check (#2476): a merge-gate workflow that filters the pull_request BASE branch.
  for (const key of prBaseBranchFilters(content)) {
    process.stderr.write(
      `[FAIL] ${file}: merge-gate workflow declares a base-branch filter '${key}' on its ` +
        `pull_request trigger — a pull request based on a task or train branch then creates NO ` +
        `RUN AT ALL and shows no failing checks because it has no checks (#2476). Remove the ` +
        `filter; gate per-branch economy with a job-level 'if:' instead.\n`,
    )
    violations++
  }

  // Check (#1491): a GATE command whose non-zero exit is swallowed by `|| true` / `|| exit 0` /
  // `|| :` — a fake-green vector. Applies to ALL workflows: a gate must fail the run wherever it
  // runs. GATE_COMMAND_RE is narrow so best-effort non-gate commands (mutation/fuzz/dep-report
  // `|| true` in nightly/monthly) are not flagged.
  {
    const lines = content.split('\n')
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      if (EXIT_SWALLOW_RE.test(line) && GATE_COMMAND_RE.test(line)) {
        process.stderr.write(
          `[FAIL] ${file}:${i + 1}: gate command exit code swallowed by '|| true' (fake-green, #1491): ${line.trim()}\n`,
        )
        violations++
      }
    }
  }
}

if (violations > 0) {
  process.stderr.write(
    `check-workflow-test-integrity: FAIL — ${violations} integrity issue(s) in workflows (INV-89)\n`,
  )
  process.exit(1)
}
process.stdout.write(
  `check-workflow-test-integrity: OK — all ${yamlFiles.length} workflow(s) pass integrity checks (INV-89)\n`,
)
process.exit(0)
