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

/**
 * Resolve the collaboration mode from arbiter.json with the enableSoloDevMode /
 * features.soloDevMode back-compat alias (ADR-051). Mirrors resolveCollaborationMode.
 */
function resolveCm(config) {
  if (config.collaborationMode) return config.collaborationMode
  if (config.enableSoloDevMode === true || config.features?.soloDevMode === true)
    return 'trunk-solo'
  return 'peer-review'
}

// PIPELINE_STYLE_TABLE (src/config/collaboration-mode-defaults.ts) — only the
// 'starter' verdict matters for the tier set.
const STYLE_TABLE = {
  'trunk-solo': { L1: 'starter', L2: 'starter', L3: 'standard', L4: 'standard' },
  'peer-review': { L1: 'starter', L2: 'standard', L3: 'standard', L4: 'standard' },
  'gated-review': { L1: 'standard', L2: 'standard', L3: 'industrial', L4: 'industrial' },
}

/**
 * #1319.2 (INV-72): when arbiter.json is present, verify the collaboration-mode /
 * governance-level-aware required tier set — the EXACT inverse of the generation
 * predicates in src/generators/github.ts. Returns a list of missing required files
 * (empty when satisfied), or null when arbiter.json is absent (floor-only mode).
 *
 * Trunk-solo's nightly requirement is satisfied by EITHER 06-nightly-lite.yml OR
 * the full 06-nightly.yml (arbiter dogfoods the full suite while remaining trunk-solo).
 */
function collabAwareMissing() {
  const cfgPath = resolve(CWD, 'arbiter.json')
  if (!existsSync(cfgPath)) return null
  let config
  try {
    config = JSON.parse(readFileSync(cfgPath, 'utf-8'))
  } catch {
    return null
  }
  const level = config.governanceLevel
  if (!level) return null
  const isL2Plus = level === 'L2' || level === 'L3' || level === 'L4'
  const isL3Plus = level === 'L3' || level === 'L4'
  const cm = resolveCm(config)
  const style = config.pipelineStyle
    ? config.pipelineStyle
    : config.ciTierMode === 'baseline'
      ? 'starter'
      : (STYLE_TABLE[cm]?.[level] ?? 'standard')

  // Each required slot is a list of acceptable filenames (OR-satisfied).
  const slots = [['01-pr-fast.yml'], ['02-pr-extended.yml'], ['03-human-approval.yml']]
  if (style !== 'starter') slots.push(['05-release.yml'])
  if (style !== 'starter' && isL3Plus && cm !== 'trunk-solo') {
    slots.push(['06-nightly.yml'], ['07-weekly.yml'], ['08-monthly.yml'])
  }
  // Trunk-solo nightly slot: lite OR full nightly satisfies it.
  if (cm === 'trunk-solo' && isL2Plus) slots.push(['06-nightly-lite.yml', '06-nightly.yml'])
  if (isL3Plus) slots.push(['09-heartbeat.yml'])

  const missingSlots = []
  for (const candidates of slots) {
    if (!candidates.some((f) => existsSync(join(WORKFLOWS_DIR, f)))) {
      missingSlots.push(candidates[0])
    }
  }
  return missingSlots
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

const collabMissing = collabAwareMissing()
if (collabMissing && collabMissing.length > 0) {
  console.error(
    `check-ci-tiers: FAIL — ${collabMissing.length} collaboration-mode-required workflow(s) missing (INV-72):`,
  )
  for (const f of collabMissing) {
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
