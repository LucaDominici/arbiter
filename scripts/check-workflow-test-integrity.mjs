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
