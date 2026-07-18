#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// arbiter — workflow runner label drift detector (INV-89)
// Validates that all workflow jobs use the expected runner label.
// Enforcing: exits 1 on unexpected labels (#2005). Use --runner or the
// `${{ ... }}` / `$CI_` expression forms for legitimate CI_BUILD_RUNNER_LABEL
// customization per INV-13 — those are not violations.
// Part of the anti-drift validator family (W6).
//
// Usage: node scripts/check-workflow-runners.mjs [--dir <path>] [--runner <label>] [--help]

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { collectYamlFiles, parseHelpAndDir } from './lib/workflow-scan.mjs'

const args = process.argv.slice(2)
const { cwd: CWD } = parseHelpAndDir(args, {
  usage: [
    'Usage: node scripts/check-workflow-runners.mjs [options]',
    '',
    'Validates that all workflow jobs use the expected runner label.',
    'Enforcing: exits 1 on unexpected labels (runner customization via --runner',
    'or ${{ ... }} / $CI_ expressions is allowed per INV-13).',
    '',
    'Options:',
    '  --dir <path>        Root directory to scan (default: cwd)',
    '  --runner <label>    Expected runner label (default: ubuntu-latest)',
    '  --help, -h          Show this help and exit',
    '',
  ].join('\n'),
})

const runnerArg = args.indexOf('--runner')
const EXPECTED_RUNNER =
  runnerArg >= 0 && args[runnerArg + 1] ? args[runnerArg + 1] : 'ubuntu-latest'

const RUNS_ON_RE = /^\s*runs-on:\s+(.+)$/

const yamlFiles = collectYamlFiles(join(CWD, '.github', 'workflows'))

let violations = 0

for (const file of yamlFiles) {
  let content
  try {
    content = readFileSync(file, 'utf-8')
  } catch {
    continue
  }
  for (const line of content.split('\n')) {
    const m = RUNS_ON_RE.exec(line)
    if (!m) continue
    const runner = m[1].trim().replace(/^['"]|['"]$/g, '')
    // Allow matrix expressions and env var refs
    if (runner.startsWith('${{') || runner.startsWith('$CI_')) continue
    if (runner !== EXPECTED_RUNNER) {
      process.stderr.write(
        `[FAIL] unexpected runner: "${runner}" (expected "${EXPECTED_RUNNER}") in ${file}\n`,
      )
      violations++
    }
  }
}

if (violations > 0) {
  process.stdout.write(
    `check-workflow-runners: FAIL — ${violations} job(s) use non-standard runner label (INV-89). ` +
      `Use "${EXPECTED_RUNNER}", pass --runner <label>, or use a \${{ ... }}/$CI_ expression for ` +
      `CI_BUILD_RUNNER_LABEL customization (INV-13).\n`,
  )
  process.exit(1)
}
process.stdout.write(
  `check-workflow-runners: OK — all jobs use expected runner "${EXPECTED_RUNNER}" (INV-89, ${yamlFiles.length} files scanned)\n`,
)
process.exit(0)
