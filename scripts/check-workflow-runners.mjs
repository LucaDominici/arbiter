#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// arbiter — workflow runner label drift detector (INV-89)
// Validates that all workflow jobs use the expected runner label.
// Advisory: warns but does not fail; runner customization is allowed per INV-13.
// Exits 0 always (unexpected labels emit WARN, not FAIL).
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
    'Advisory: warns but does not fail (runner customization allowed per INV-13).',
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
        `[WARN] unexpected runner: "${runner}" (expected "${EXPECTED_RUNNER}") in ${file}\n`,
      )
      violations++
    }
  }
}

if (violations > 0) {
  process.stdout.write(
    `check-workflow-runners: WARN — ${violations} job(s) use non-standard runner label (INV-89)\n`,
  )
  // Informational only — exits 0 to allow CI_BUILD_RUNNER_LABEL customization (INV-13)
  process.exit(0)
}
process.stdout.write(
  `check-workflow-runners: OK — all jobs use expected runner "${EXPECTED_RUNNER}" (INV-89, ${yamlFiles.length} files scanned)\n`,
)
process.exit(0)
