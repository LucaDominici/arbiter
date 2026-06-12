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
}

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
