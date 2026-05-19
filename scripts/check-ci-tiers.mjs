#!/usr/bin/env node
// arbiter — self CI tier presence gate (INV-73)
// Reads minPresent from src/invariants/catalog.ts INV-73 entry.
// Exits 0: at least minPresent of the 8 canonical workflow files are present.
// Exits 1: fewer than minPresent are present.
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const CWD = process.cwd()
const WORKFLOWS_DIR = join(CWD, '.github', 'workflows')

// All 8 canonical workflow files (INV-73 SSOT)
const ALL_CANONICAL = [
  '01-pr-fast.yml',
  '02-pr-extended.yml',
  '03-human-approval.yml',
  '05-release.yml',
  '06-nightly.yml',
  '07-weekly.yml',
  '08-monthly.yml',
  '09-heartbeat.yml',
]

/**
 * Read the minPresent value from the INV-73 entry in src/invariants/catalog.ts.
 * Falls back to requiring all 8 if catalog is absent or entry not found.
 */
function readMinPresent() {
  const catalogPath = resolve(CWD, 'src/invariants/catalog.ts')
  if (!existsSync(catalogPath)) return ALL_CANONICAL.length
  let src
  try {
    src = readFileSync(catalogPath, 'utf-8')
  } catch {
    return ALL_CANONICAL.length
  }
  // Match the INV-73 block (from id: 'INV-73' to the next top-level object or end)
  const inv73Block = src.match(/id:\s*['"]INV-73['"][\s\S]*?(?=\},\s*\{|\},\s*\/\/|$)/)
  if (!inv73Block) return ALL_CANONICAL.length
  const minPresentMatch = inv73Block[0].match(/minPresent:\s*(\d+)/)
  if (!minPresentMatch) return ALL_CANONICAL.length
  return parseInt(minPresentMatch[1], 10)
}

const minPresent = readMinPresent()

const present = ALL_CANONICAL.filter((f) => existsSync(join(WORKFLOWS_DIR, f)))
const missing = ALL_CANONICAL.filter((f) => !existsSync(join(WORKFLOWS_DIR, f)))

if (present.length < minPresent) {
  console.error(
    `check-ci-tiers: FAIL — only ${present.length}/${ALL_CANONICAL.length} canonical workflows present; need at least ${minPresent} (INV-73, minPresent=${minPresent}):`,
  )
  for (const f of missing) {
    console.error(`  missing: .github/workflows/${f}`)
  }
  process.exit(1)
}

if (missing.length > 0) {
  console.log(
    `check-ci-tiers: WARN — ${missing.length} canonical workflow(s) not yet present (not yet required by INV-73 minPresent=${minPresent}):`,
  )
  for (const f of missing) {
    console.log(`  missing: .github/workflows/${f}`)
  }
}

console.log(
  `check-ci-tiers: OK — ${present.length}/${ALL_CANONICAL.length} canonical workflows present (INV-73 minPresent=${minPresent})`,
)
process.exit(0)
