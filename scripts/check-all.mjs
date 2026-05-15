#!/usr/bin/env node
// arbiter quality gate
// Usage: node scripts/check-all.mjs [L1|L2|L3] [--json [path]]
// L1: typecheck, format, lint, unit tests, circular deps, placeholders, spdx headers,
//     orphan TODOs, commitlint, test naming, hardness inventory, docs, matrix fixtures,
//     matrix proven cells, template tests, generator tests, command tests, catalog parity,
//     enforcement wired, workflow runners, ci alignment, node version ssot, bloat ratchet,
//     exit code contract, pipe/tee hazard, ssot core, doc links, knowledge map,
//     canonical paths (31)
// L2: L1 + coverage + dead code + duplication + npm audit + gitleaks + dogfood +
//     self-validation drill + local-ci parity (40)
// L3: L2 + full repo secrets scan (nightly/manual)
//
// --json [path]: emit gate result JSON to path (default: .arbiter/gate/local-result.json)
//   Writes schema arbiter-gate-v1 with parityContentHash over static L1 gate subset.
//
// NOTE: this file runs without a build step and cannot import from src/.
// src/ code goes through src/utils/run-cli.ts (INV-12). Gate scripts use the
// helper trinity in scripts/lib/run-helpers.mjs (#351, CANON-01): runCheck (HARD),
// runWarnCheck (informational), runToolCheck (CI-aware tool gate).
import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { runCheck, getResults, getFailed } from './lib/run-helpers.mjs'

// Parse positional level arg and optional --json [path] flag
let level = 'L2'
let jsonPath = null // null = write to default path; string = write to that path
const _rawArgs = process.argv.slice(2)
for (let _i = 0; _i < _rawArgs.length; _i++) {
  if (_rawArgs[_i] === '--json') {
    if (_i + 1 < _rawArgs.length && !_rawArgs[_i + 1].startsWith('-')) {
      jsonPath = _rawArgs[++_i]
    } else {
      jsonPath = '' // triggers default path resolution below
    }
  } else if (['L1', 'L2', 'L3'].includes(_rawArgs[_i])) {
    level = _rawArgs[_i]
  }
}

// When the pre-commit hook rsyncs to a temp dir to work around the Vite '#' bug,
// git-dependent checks (commitlint, docs) must run from the original repo path.
const GIT_CWD = process.env.ARBITER_HOOK_GIT_CWD

// Gates excluded from parityContentHash (INV-59): these differ structurally between
// local and CI environments — PR-only gates or tests run with different selectors.
const PARITY_EXCLUDE = new Set(['commitlint', 'docs', 'unit tests'])

console.log('')
console.log(`=== arbiter Quality Gate: ${level} ===`)
console.log('')

// ─── L1: Fast checks ─────────────────────────────────────────────────────────
runCheck('typecheck', 'npx', ['tsc', '--noEmit'])
runCheck('format', 'npx', ['prettier', '--check', '.'])
runCheck('lint', 'npx', ['eslint', 'src', '__tests__'])
runCheck('unit tests', 'npm', ['test'])
runCheck('circular deps', 'npx', ['madge', '--circular', '--extensions', 'ts', 'src/'])
runCheck('placeholders', 'node', ['scripts/check-no-placeholders.mjs', 'src'])
runCheck('spdx headers', 'node', ['scripts/check-spdx-headers.mjs'])
runCheck('orphan TODOs', 'node', ['scripts/check-no-orphan-todo.mjs'])
runCheck('PII scan', 'node', ['scripts/pii-scan.mjs'])
runCheck('inline suppressions', 'node', ['scripts/check-inline-suppressions.mjs'])
runCheck('suppressions expiry', 'node', ['scripts/check-suppressions.mjs'])
runCheck('commitlint', 'npx', ['commitlint', '--from', 'origin/main', '--to', 'HEAD'], {
  cwd: GIT_CWD,
})
runCheck('test naming', 'node', ['scripts/check-test-naming.mjs'])
runCheck('hardness inventory', 'node', ['scripts/check-hardness-inventory.mjs'])
runCheck('docs', 'node', ['scripts/check-docs.mjs'], { cwd: GIT_CWD })
runCheck('matrix fixtures', 'node', ['scripts/check-matrix-fixtures.mjs'])
runCheck('matrix proven cells', 'node', ['scripts/check-matrix-proven-cells.mjs'])
runCheck('template tests', 'node', ['scripts/check-template-tests.mjs'])
runCheck('generator tests', 'node', ['scripts/check-generator-tests.mjs'])
runCheck('command tests', 'node', ['scripts/check-command-tests.mjs'])
runCheck('catalog parity', 'node', ['scripts/check-catalog-agents-parity.mjs'])
runCheck('enforcement wired', 'node', ['scripts/check-inv-enforcement-wired.mjs'])
runCheck('workflow runners', 'node', ['scripts/check-workflow-runners.mjs'])
runCheck('ci alignment', 'node', ['scripts/check-ci-alignment.mjs'])
runCheck('node version ssot', 'node', ['scripts/check-node-version-ssot.mjs'])
runCheck('bloat ratchet', 'node', ['scripts/check-bloat-ratchet.mjs'])
runCheck('exit code contract', 'node', ['scripts/check-exit-code-contract.mjs'])
runCheck('pipe/tee hazard', 'node', ['scripts/check-pipe-tee-hazard.mjs'])
runCheck('ssot core', 'node', ['scripts/check-ssot-core.mjs'])
runCheck('doc links', 'node', ['scripts/check-doc-links.mjs'])
runCheck('knowledge map', 'node', ['scripts/check-knowledge-map.mjs'])
runCheck('canonical paths', 'node', ['scripts/check-canonical-paths.mjs'])

// Capture L1 boundary for parityContentHash computation (INV-59)
const l1EndIdx = getResults().length

// ─── L2/L3: Full checks ───────────────────────────────────────────────────────
if (level === 'L2' || level === 'L3') {
  runCheck('coverage', 'npm', ['test', '--', '--coverage'])
  runCheck('dead code', 'npx', ['knip'])
  runCheck('duplication', 'npx', ['jscpd', '--silent'])
  runCheck('audit', 'npm', ['audit', '--audit-level=high'])
  runCheck('gitleaks', 'gitleaks', [
    'detect',
    '--source',
    '.',
    '--config',
    '.gitleaks.toml',
    '--gitleaks-ignore-path',
    'suppressions/.gitleaksignore',
    '--exit-code',
    '1',
  ])
  runCheck('dogfood', 'node', ['scripts/check-self-dogfood.mjs'])
  runCheck('debt ratchet', 'node', ['scripts/debt-report.mjs', '--gate'])
  // STRIDE/RACI traceability deliberately NOT wired here yet: the docs/SECURITY/STRIDE.md
  // and docs/GOVERNANCE/RACI.md tables have zero HIGH/CRITICAL rows, so the script
  // would exit 0 unconditionally. Wiring a no-op gate would be a CANON-09 lie. Wire
  // only after at least one threat/responsibility row is documented (#350-followup).
  runCheck('self-validation drill', 'node', ['scripts/self-validation.mjs'])
  runCheck('local-ci parity', 'node', ['scripts/check-local-ci-parity.mjs'])
  runCheck('id stability', 'node', ['scripts/check-id-stability.mjs'])
}

// ─── Summary ─────────────────────────────────────────────────────────────────
const results = getResults()
const failed = getFailed()

console.log('')
console.log('=== Summary ===')
console.log('')

const nameWidth = Math.max(6, ...results.map((r) => r.name.length))
const header = `${'Check'.padEnd(nameWidth)}  Status  Elapsed`
const divider = '-'.repeat(header.length)
console.log(header)
console.log(divider)
let totalElapsed = 0
for (const r of results) {
  totalElapsed += r.elapsed
  console.log(`${r.name.padEnd(nameWidth)}  ${r.status.padEnd(6)}  ${r.elapsed}ms`)
}
console.log(divider)
console.log(`${'Total'.padEnd(nameWidth)}          ${totalElapsed}ms`)
console.log('')

// ─── Gate result JSON (INV-59) ────────────────────────────────────────────────
{
  const l1Gates = results.slice(0, l1EndIdx)
  const parityGates = l1Gates
    .filter((r) => !PARITY_EXCLUDE.has(r.name))
    .map((r) => ({ name: r.name, pass: r.status === 'PASS' }))
    .sort((a, b) => a.name.localeCompare(b.name))

  const parityContentHash = createHash('sha256').update(JSON.stringify(parityGates)).digest('hex')

  const allForHash = results
    .map((r) => ({ name: r.name, pass: r.status === 'PASS' }))
    .sort((a, b) => a.name.localeCompare(b.name))

  const contentHash = createHash('sha256').update(JSON.stringify(allForHash)).digest('hex')

  const artifact = {
    schema: 'arbiter-gate-v1',
    node: process.version,
    level,
    gates: results.map((r) => ({
      name: r.name,
      pass: r.status === 'PASS',
      durationMs: r.elapsed,
    })),
    parityGates,
    pass: failed === 0,
    parityContentHash,
    contentHash,
  }

  const outPath =
    jsonPath !== null && jsonPath !== ''
      ? jsonPath
      : resolve(GIT_CWD ?? process.cwd(), '.arbiter/gate/local-result.json')

  try {
    mkdirSync(dirname(outPath), { recursive: true })
    writeFileSync(outPath, JSON.stringify(artifact, null, 2) + '\n')
  } catch (err) {
    process.stderr.write(
      `check-all: warning: could not write gate result to ${outPath}: ${err.message}\n`,
    )
  }
}

if (failed > 0) {
  console.error(`=== FAILED: ${failed} check(s) ===\n`)
  process.exit(1)
} else {
  console.log('=== ALL PASSED ===\n')
}
