#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// arbiter — workflow job naming convention drift detector (INV-89)
// Validates that all workflow jobs have explicit name: fields.
// Exits 0 when all jobs have names; exits 1 when unnamed jobs are found.
// Part of the anti-drift validator family (W6).
//
// Usage: node scripts/check-workflow-job-naming.mjs [--dir <path>] [--help]

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { collectYamlFiles, parseHelpAndDir } from './lib/workflow-scan.mjs'

const args = process.argv.slice(2)
const { cwd: CWD } = parseHelpAndDir(args, {
  usage: [
    'Usage: node scripts/check-workflow-job-naming.mjs [options]',
    '',
    'Validates that all workflow jobs have explicit name: fields.',
    'Exits 0 when all jobs have names; exits 1 when unnamed jobs are found.',
    '',
    'Options:',
    '  --dir <path>    Root directory to scan (default: cwd)',
    '  --help, -h      Show this help and exit',
    '',
  ].join('\n'),
})

// Match job IDs at indentation level 2 (under jobs:)
const JOB_ID_RE = /^  ([a-z][a-z0-9_-]*):\s*$/
const JOB_NAME_RE = /^    name:/

const yamlFiles = collectYamlFiles(join(CWD, '.github', 'workflows'))

let violations = 0

for (const file of yamlFiles) {
  let content
  try {
    content = readFileSync(file, 'utf-8')
  } catch {
    continue
  }
  const lines = content.split('\n')
  let inJobs = false
  let pendingJobId = null
  let pendingLineIdx = -1

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (line.startsWith('jobs:')) {
      inJobs = true
      continue
    }
    if (!inJobs) continue

    if (pendingJobId) {
      // Next line after job ID — check if it has 'name:'
      if (JOB_NAME_RE.test(line)) {
        pendingJobId = null
      } else if (
        line.startsWith('    runs-on:') ||
        line.startsWith('    steps:') ||
        line.startsWith('    needs:')
      ) {
        process.stderr.write(
          `[FAIL] job "${pendingJobId}" in ${file}:${pendingLineIdx + 1} has no name: field\n`,
        )
        violations++
        pendingJobId = null
      } else if (JOB_ID_RE.test(line)) {
        // new job id without prior job having been resolved
        process.stderr.write(
          `[FAIL] job "${pendingJobId}" in ${file}:${pendingLineIdx + 1} has no name: field\n`,
        )
        violations++
        const m = JOB_ID_RE.exec(line)
        pendingJobId = m ? m[1] : null
        pendingLineIdx = i
      }
    } else {
      const m = JOB_ID_RE.exec(line)
      if (m) {
        pendingJobId = m[1]
        pendingLineIdx = i
      }
    }
  }

  if (pendingJobId) {
    process.stderr.write(
      `[FAIL] job "${pendingJobId}" in ${file}:${pendingLineIdx + 1} has no name: field\n`,
    )
    violations++
  }
}

if (violations > 0) {
  process.stderr.write(
    `check-workflow-job-naming: FAIL — ${violations} workflow job(s) missing name: field (INV-89)\n`,
  )
  process.exit(1)
}
process.stdout.write(
  `check-workflow-job-naming: OK — all workflow jobs have name: fields (INV-89, ${yamlFiles.length} files scanned)\n`,
)
process.exit(0)
