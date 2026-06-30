#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// probe-writer-audit.mjs — full-matrix probe↔writer alignment audit (#1707).
//
// Safety net for the "probe≠writer" class: a conformance probe reading a
// field/path/shape the generator never emits, so generated projects fail
// conformance by construction. The per-PR guard (#1704,
// __tests__/conformance/probe-writer-alignment.test.ts) prevents INTRODUCTION
// on a PR but its matrix is hardcoded (3 cells). This script is the periodic
// DETECTION across the full archetype×level matrix — it catches drift that
// slips through (a new dim/archetype not in the per-PR guard's matrix, or a
// weakened/bypassed guard).
//
// For each cell: runs the REAL generators (in-process, same as the #1704 guard)
// into a tmpdir with a known-good ProjectConfig, runs the REAL conformance
// engine, and asserts the guard's classification:
//   - GENERATOR_SATISFIED dims (the generator emits the probe's primary
//     artifact) → Y (or NA when not prescribed, e.g. D-INVARIANTS at L1-essential
//     per #1699, D-LIVE-E2E for non-service, D-FE-RENDER-GATE for non-FE). A
//     GENERATOR_SATISFIED dim scoring N is the probe≠writer mismatch.
//   - RUNTIME dims (absent on a fresh clone) → NV/NA. A runtime dim scoring N is
//     the gitignore≠fresh-clone hole (fixed for these in #1701).
//   - D-FE-RENDER-GATE + D-LIVE-E2E → Y or NA (never N — they are archetype-gated).
//   - D-DONE-EVIDENCE is the ONE known exception (absent→N asymmetry, tracked
//     separately) — its N on a fresh clone is expected, not a mismatch.
//   - Other dims (DOC-README, D-DOMAIN-API, …) may legitimately score N when the
//     config does not prescribe them (e.g. hasPublicApi=false) — NOT a mismatch.
//
// Uses the in-process generators API (dist) — NOT `arbiter init` — because the
// CLI's `-y` minimal defaults do not enable the commitlint/docs generators that
// a known-good ProjectConfig does, which would confound probe≠writer with the
// (separate) "minimal-init non-conformance" gap.
//
// Exits 1 on any mismatch (anti-fake-green). Exits 0 when every cell is clean.
// Run weekly via .github/workflows/probe-writer-audit.yml.
//
// Usage:
//   node scripts/probe-writer-audit.mjs                # full matrix
//   node scripts/probe-writer-audit.mjs --dry-run      # print the plan, run nothing
//   node scripts/probe-writer-audit.mjs --cells L2     # subset by level
//
// Import-friendly: `main()` runs only when invoked directly; the audit logic is
// exported for unit tests. main() dynamically imports the dist APIs so the unit
// tests (which do not call the non-dry-run path) do not require a build.

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Representative archetype×level×language matrix. The probe≠writer class is
// largely language-agnostic (probes read manifests, generators emit them), so
// typescript covers the discipline + docs probes; language coverage can be
// expanded via ARBITER_AUDIT_LANGS. Override the whole matrix with
// ARBITER_AUDIT_CELLS="archetype:level:lang,...".
const DEFAULT_CELLS = [
  { archetype: 'library', level: 'L1', language: 'typescript' },
  { archetype: 'library', level: 'L2', language: 'typescript' },
  { archetype: 'library', level: 'L3', language: 'typescript' },
  { archetype: 'cli', level: 'L2', language: 'typescript' },
  { archetype: 'backend-web-db', level: 'L2', language: 'typescript' },
  { archetype: 'backend-web-db', level: 'L3', language: 'typescript' },
  { archetype: 'frontend-spa', level: 'L2', language: 'typescript' },
  { archetype: 'data-pipeline', level: 'L2', language: 'python' },
  { archetype: 'embedded', level: 'L2', language: 'rust' },
]

// Guard classification (mirrors __tests__/conformance/probe-writer-alignment.test.ts).
// A dim in these sets scoring N on a fresh-generated project is a mismatch.
const GENERATOR_SATISFIED = new Set([
  'D-TEST-LEVELS',
  'D-INVARIANTS-ENFORCED',
  'D-COMMIT-HYGIENE',
  'DOC-CONTRIBUTING',
  'DOC-SECURITY',
])
const RUNTIME_NON_N = new Set([
  'D-GATE-GREEN',
  'D-COVERAGE-THRESHOLDS',
  'D-NO-OVERCLAIM',
  'DISC-finding-hygiene',
  'DOC-API-DOCS',
])
// Archetype-gated dims: Y or NA (never N) on a fresh-generated project.
const ARCHETYPE_GATED = new Set(['D-FE-RENDER-GATE', 'D-LIVE-E2E'])
// D-DONE-EVIDENCE is the known absent→N asymmetry on a fresh clone (the
// done-evidence file is runtime-produced, absent on a fresh-generated tree).
const KNOWN_FRESH_CLONE_N = new Set(['D-DONE-EVIDENCE'])

const MUST_NOT_BE_N = new Set([...GENERATOR_SATISFIED, ...RUNTIME_NON_N, ...ARCHETYPE_GATED])

/**
 * Audit a single conformance result for a fresh-generated project.
 * Pure function: no IO. Returns { pass, mismatches }.
 *
 * @param {{archetype:string,level:string,language:string}} cell
 * @param {{status:string, verdict:string, dimensions:Array<{id:string, verdict:string}>}} result
 */
export function auditConformanceResult(cell, result) {
  const mismatches = []
  const label = `${cell.archetype}/${cell.level}/${cell.language}`

  if (result?.status === 'skip') {
    return {
      pass: false,
      mismatches: [
        `${label}: conformance status=skip — cell was not governed (generation failed?)`,
      ],
    }
  }

  const dims = Array.isArray(result?.dimensions) ? result.dimensions : []
  if (dims.length === 0) {
    return {
      pass: false,
      mismatches: [`${label}: no dimensions in conformance result`],
    }
  }

  for (const dim of dims) {
    if (dim.verdict !== 'N') continue
    if (KNOWN_FRESH_CLONE_N.has(dim.id)) continue // expected asymmetry
    if (MUST_NOT_BE_N.has(dim.id)) {
      mismatches.push(
        `${label}: ${dim.id} = N (spurious — a fresh-generated project must not score N on this dim; either the generator does not emit the probe's artifact (probe≠writer) or a runtime dim scored N instead of NV/NA)`,
      )
    }
    // dims NOT in MUST_NOT_BE_N (e.g. DOC-README, D-DOMAIN-API) may legitimately
    // score N when the config does not prescribe them — NOT a mismatch.
  }

  return { pass: mismatches.length === 0, mismatches }
}

export { DEFAULT_CELLS as CELLS }
export { GENERATOR_SATISFIED, RUNTIME_NON_N, ARCHETYPE_GATED, KNOWN_FRESH_CLONE_N }

function parseCellsFromEnv() {
  const raw = process.env.ARBITER_AUDIT_CELLS
  if (!raw) return null
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const [archetype, level, language = 'typescript'] = s.split(':')
      return { archetype, level, language }
    })
}

// invariantTiers per level (mirrors src/invariants/filter.ts presetToTiers +
// defaultPresetForLevel, hardcoded so the script does not import src/).
const TIERS_BY_LEVEL = {
  L1: ['architectural', 'governance'],
  L2: ['architectural', 'governance', 'data', 'operational'],
  L3: ['architectural', 'governance', 'data', 'security', 'operational'],
  L4: ['architectural', 'governance', 'data', 'security', 'operational'],
}

/** Build a known-good ProjectConfig (mirrors __tests__/helpers.ts makeConfig). */
function buildCellConfig(dir, cell) {
  const level = TIERS_BY_LEVEL[cell.level] ? cell.level : 'L2'
  return {
    targetDir: dir,
    projectName: 'audit-cell',
    description: 'probe-writer audit cell',
    language: cell.language,
    framework: null,
    archetype: cell.archetype,
    architectureStyle: 'none',
    isMultiTenant: false,
    hasDatabase: cell.archetype === 'backend-web-db',
    hasPublicApi: false,
    buildTool: 'npm',
    buildCommand: 'npm run build',
    testCommand: 'npm test',
    lintCommand: 'npm run lint',
    formatCommand: 'npx prettier --check .',
    tools: ['claude', 'codex'],
    governanceLevel: level,
    useGitHub: true,
    githubOwner: 'acme',
    githubRepo: 'r',
    existing: {
      agentsMd: false,
      claudeDir: false,
      agentsDir: false,
      aiRulez: false,
      settingsJson: false,
      checkAllScript: false,
      geminiDir: false,
      windsurfRules: false,
      aiderConf: false,
    },
    languageHooks: [],
    enableDebtGates: level !== 'L1',
    enableSuppressions: true,
    enableSecurityScanning: level !== 'L1',
    enableSoloDevMode: false,
    invariantTiers: TIERS_BY_LEVEL[level],
    basePackage: undefined,
    contractType: 'none',
    lanes: [],
  }
}

let _distApis = null
async function loadDistApis() {
  if (_distApis) return _distApis
  const root = process.cwd()
  // Prefer the built dist (CI runs after `npm run build`); fall back to src TS
  // is not viable from a .mjs, so dist is required for the live run.
  const initMod = await import(join(root, 'dist', 'commands', 'init.js'))
  const confMod = await import(join(root, 'dist', 'commands', 'conformance.js'))
  _distApis = {
    runGenerators: initMod.runGenerators,
    buildArbiterConfig: initMod.buildArbiterConfig,
    runConformance: confMod.runConformance,
  }
  return _distApis
}

async function runCell(cell) {
  const label = `${cell.archetype}/${cell.level}/${cell.language}`
  const { runGenerators, buildArbiterConfig, runConformance } = await loadDistApis()
  const dir = mkdtempSync(join(tmpdir(), 'probe-writer-audit-'))
  try {
    const config = buildCellConfig(dir, cell)
    writeFileSync(
      join(dir, 'arbiter.json'),
      JSON.stringify(buildArbiterConfig(config), null, 2) + '\n',
    )
    let result
    try {
      runGenerators(config)
      result = runConformance({ dir })
      // FAIL-OPEN-INTENT: a generation/conformance throw means the cell cannot be audited — recorded as a mismatch (fail-closed for the audit: main() exits 1 on any mismatch); the error is surfaced in the mismatch message.
    } catch (e) {
      return {
        pass: false,
        mismatches: [
          `${label}: generation/conformance threw — ${e instanceof Error ? e.message : String(e)}`,
        ],
      }
    }
    return auditConformanceResult(cell, result)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

function parseArgs(args) {
  const dryRun = args.includes('--dry-run')
  const cellsIdx = args.indexOf('--cells')
  const levelFilter = cellsIdx >= 0 ? args[cellsIdx + 1] : null
  return { dryRun, levelFilter }
}

async function main() {
  const { dryRun, levelFilter } = parseArgs(process.argv.slice(2))

  let cells = parseCellsFromEnv() ?? DEFAULT_CELLS
  if (levelFilter) cells = cells.filter((c) => c.level === levelFilter)

  if (dryRun) {
    process.stdout.write(`probe-writer-audit: DRY RUN — ${cells.length} cell(s)\n`)
    for (const c of cells) process.stdout.write(`  - ${c.archetype}/${c.level}/${c.language}\n`)
    process.stdout.write(`must-not-be-N dims: ${[...MUST_NOT_BE_N].join(', ')}\n`)
    process.stdout.write(`known fresh-clone N (expected): ${[...KNOWN_FRESH_CLONE_N].join(', ')}\n`)
    process.exit(0)
  }

  process.stdout.write(
    `probe-writer-audit: auditing ${cells.length} cell(s) via in-process generators (dist)\n`,
  )
  const allMismatches = []
  let ok = 0
  for (const cell of cells) {
    const res = await runCell(cell)
    if (res.pass) {
      ok++
      process.stdout.write(`  ✓ ${cell.archetype}/${cell.level}/${cell.language}\n`)
    } else {
      process.stdout.write(`  ✗ ${cell.archetype}/${cell.level}/${cell.language}\n`)
      for (const m of res.mismatches) process.stdout.write(`      ${m}\n`)
      allMismatches.push(...res.mismatches)
    }
  }

  process.stdout.write(`\nprobe-writer-audit: ${ok}/${cells.length} cell(s) clean\n`)
  if (allMismatches.length > 0) {
    process.stderr.write(
      `probe-writer-audit: FAIL — ${allMismatches.length} mismatch(es) across the matrix.\n` +
        `A spurious N on a fresh-generated project means a conformance probe reads a\n` +
        `field/path/shape the generator never emits (probe≠writer). Fix the probe or the\n` +
        `generator, and add the cell to the per-PR guard (#1704).\n`,
    )
    process.exit(1)
  }
  process.stdout.write('probe-writer-audit: ALL CLEAN\n')
  process.exit(0)
}

const invokedDirectly =
  process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/^file:\/\//, ''))
if (invokedDirectly) {
  try {
    await main()
  } catch (err) {
    process.stderr.write(`probe-writer-audit: unexpected error — ${err?.stack ?? err}\n`)
    process.exit(1)
  }
}
