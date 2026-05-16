#!/usr/bin/env node
// Scans .github/workflows/*.yml for hardcoded runs-on values.
// Fails if any job uses a literal runner instead of the canonical var reference.
// Usage: node scripts/check-workflow-runners.mjs
// Exits 1 if any violations are found.
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'

const WORKFLOWS_DIR = join(process.cwd(), '.github', 'workflows')
// Any vars.* reference is accepted — value is set per-repo/env, not hardcoded.
// Originally checked only CI_BUILD_RUNNER_LABEL; generalized to allow
// workflow-specific runner variables (e.g. BROWSER_RUNNER_LABEL for a11y jobs).
const RUNNER_VAR_PATTERN = /\$\{\{\s*vars\./
// Dynamic matrix references are allowed (e.g. ${{ matrix.os }}) because the
// value is set at runtime and is not a hardcoded literal runner name.
const MATRIX_RUNNER_PATTERN = /\$\{\{\s*matrix\./
const RUNS_ON_PATTERN = /^\s*runs-on:/

const baseDir = process.cwd()
let violations = 0

let files
try {
  files = readdirSync(WORKFLOWS_DIR).filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
} catch (err) {
  if (err.code === 'ENOENT') process.exit(0)
  console.error(`check-workflow-runners: cannot read ${WORKFLOWS_DIR}: ${err.message}`)
  process.exit(1)
}

for (const file of files) {
  const full = join(WORKFLOWS_DIR, file)
  let content
  try {
    content = readFileSync(full, 'utf-8')
  } catch (err) {
    console.error(`check-workflow-runners: cannot read ${relative(baseDir, full)}: ${err.message}`)
    violations++
    continue
  }
  const lines = content.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (!RUNS_ON_PATTERN.test(line)) continue
    if (!RUNNER_VAR_PATTERN.test(line) && !MATRIX_RUNNER_PATTERN.test(line)) {
      const rel = relative(baseDir, full)
      console.error(`  ${rel}:${i + 1}  ${line.trim()}`)
      violations++
    }
  }
}

if (violations > 0) {
  console.error(
    `\n  Found ${violations} violation(s). Use \${{ vars.CI_BUILD_RUNNER_LABEL || 'docker-ci-build' }} (or another vars.* reference) for runs-on.\n`,
  )
  process.exit(1)
}
