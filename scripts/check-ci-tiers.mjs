#!/usr/bin/env node
// arbiter — self CI tier presence gate (INV-73, transition mode)
// migrationStatus: transition — requires 4 of 8 canonical workflow files (W4 baseline).
// Exits 0: required 4 present (warns about missing optional ones).
// Exits 1: one or more of the required 4 is missing.
import { existsSync } from 'node:fs'
import { join } from 'node:path'

const CWD = process.cwd()
const WORKFLOWS_DIR = join(CWD, '.github', 'workflows')

// Required in transition mode (W4 baseline — 4/8 canonical)
const REQUIRED = [
  '01-pr-fast.yml',
  '02-pr-extended.yml',
  '03-human-approval.yml',
  '09-heartbeat.yml',
]

// Present in full mode (W10 complete — 8/8); warn only in transition
const OPTIONAL_FULL = ['05-release.yml', '06-nightly.yml', '07-weekly.yml', '08-monthly.yml']

const missing = REQUIRED.filter((f) => !existsSync(join(WORKFLOWS_DIR, f)))

if (missing.length > 0) {
  console.error(
    `check-ci-tiers: FAIL — ${missing.length} required workflow(s) missing (INV-73 transition):`,
  )
  for (const f of missing) {
    console.error(`  missing: .github/workflows/${f}`)
  }
  process.exit(1)
}

const missingOptional = OPTIONAL_FULL.filter((f) => !existsSync(join(WORKFLOWS_DIR, f)))
if (missingOptional.length > 0) {
  console.log(
    `check-ci-tiers: WARN — ${missingOptional.length} optional workflow(s) not yet present (W10 target):`,
  )
  for (const f of missingOptional) {
    console.log(`  missing: .github/workflows/${f}`)
  }
}

console.log(
  `check-ci-tiers: OK — all ${REQUIRED.length} required baseline workflows present (INV-73 transition mode)`,
)
process.exit(0)
