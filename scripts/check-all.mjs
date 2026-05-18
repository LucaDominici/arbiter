#!/usr/bin/env node
// arbiter quality gate
// Usage: node scripts/check-all.mjs [subcommand] [--level L1|L2|L3] [--json [path]]
//   Subcommands: check (T1 fast, ~2 min), gate (T1+T2, ~10 min, default),
//                full (T1+T2+T3 dry-run, ~35 min),
//                simulate-nightly (T4), simulate-weekly (T5)
//   Back-compat: L1 → check --level L1, L2 → gate --level L2, L3 → gate --level L3
//
// check: build-kit, no redacted tokens, private paths ignored,
//        typecheck, format, lint, unit tests, circular deps, placeholders, i18n raw strings,
//        spdx headers, orphan TODOs, commitlint, test naming, hardness inventory, docs,
//        matrix fixtures, matrix proven cells, template tests, generator tests, command tests,
//        catalog parity, enforcement wired, workflow runners, ci alignment, node version ssot,
//        bloat ratchet, exit code contract, pipe/tee hazard, ssot core, doc links, knowledge map,
//        canonical paths, plugin api stability, deprecations, hook contracts, api snapshot (41)
// gate: check + coverage + docs:build + dead code + duplication + npm audit + gitleaks +
//       dogfood + self-validation drill + local-ci parity + id stability + anti-telemetry +
//       tdd-evidence (54)
//
// --json [path]: emit gate result JSON to path (default: .arbiter/gate/local-result.json)
//   Writes schema arbiter-gate-v1 with parityContentHash over static check gate subset.
//
// NOTE: this file runs without a build step and cannot import from src/.
// src/ code goes through src/utils/run-cli.ts (INV-12). Gate scripts use the
// helper trinity in scripts/lib/run-helpers.mjs (#351, CANON-01): runCheck (HARD),
// runWarnCheck (informational), runToolCheck (CI-aware tool gate).
import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { runCheck, getResults, getFailed } from './lib/run-helpers.mjs'
import { parseCheckArgs } from './lib/parse-check-args.mjs'

const { subcommand, level, jsonPath: _parsedJsonPath } = parseCheckArgs(process.argv.slice(2))
let jsonPath = _parsedJsonPath

// When the pre-commit hook rsyncs to a temp dir to work around the Vite '#' bug,
// git-dependent checks (commitlint, docs) must run from the original repo path.
const GIT_CWD = process.env.ARBITER_HOOK_GIT_CWD

// Gates excluded from parityContentHash (INV-59): these differ structurally between
// local and CI environments — PR-only gates or tests run with different selectors.
const PARITY_EXCLUDE = new Set(['commitlint', 'docs', 'unit tests'])

process.stdout.write('\n')
process.stdout.write(`=== arbiter Quality Gate: ${subcommand} [${level}] ===\n`)
process.stdout.write('\n')

// ─── check: T1 fast checks ───────────────────────────────────────────────────
runCheck('build-kit', 'node', ['scripts/build-kit.mjs'])
runCheck('no redacted tokens', 'node', ['scripts/check-no-redacted-tokens.mjs'])
runCheck('private paths ignored', 'node', ['scripts/check-private-paths-ignored.mjs'])
runCheck('typecheck', 'npx', ['tsc', '--noEmit'])
runCheck('format', 'npx', ['prettier', '--check', '.'])
runCheck('lint', 'npx', ['eslint', 'src', '__tests__'])
runCheck('unit tests', 'npm', ['test'])
runCheck('circular deps', 'npx', ['madge', '--circular', '--extensions', 'ts', 'src/'])
runCheck('placeholders', 'node', ['scripts/check-no-placeholders.mjs', 'src'])
runCheck('i18n raw strings', 'node', [
  'scripts/check-no-raw-strings.mjs',
  'src',
  '--inventory',
  '__tests__/i18n/_migration-inventory.json',
])
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
runCheck('skills-matrix-schema', 'node', ['scripts/check-skills-matrix.mjs'])
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
runCheck('plugin api stability', 'node', ['scripts/check-plugin-api-stability.mjs'])
runCheck('deprecations', 'node', ['scripts/check-deprecations.mjs'])
runCheck('hook contracts', 'node', ['scripts/check-hook-contracts.mjs'])
runCheck('api snapshot', 'node', ['scripts/check-api-snapshot.mjs'])
runCheck('self-dogfood (INV-75/76)', 'node', ['scripts/check-arbiter-self-dogfood.mjs'])

// Capture L1 boundary for parityContentHash computation (INV-59)
const l1EndIdx = getResults().length

// ─── gate: T1+T2 extended checks ─────────────────────────────────────────────
if (subcommand !== 'check') {
  runCheck('coverage', 'npm', ['test', '--', '--coverage'])
  runCheck('docs:build', 'npm', ['run', 'docs:build'])
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
  runCheck('STRIDE/RACI traceability', 'node', ['scripts/check-stride-traceability.mjs'])
  runCheck('self-validation drill', 'node', ['scripts/self-validation.mjs'])
  runCheck('local-ci parity', 'node', ['scripts/check-local-ci-parity.mjs'])
  runCheck('id stability', 'node', ['scripts/check-id-stability.mjs'])
  runCheck('anti-telemetry', 'node', ['scripts/check-anti-telemetry.mjs'])
  runCheck('tdd-evidence', 'node', ['scripts/check-tdd-evidence.mjs'])
}

// ─── Summary ─────────────────────────────────────────────────────────────────
const results = getResults()
const failed = getFailed()

process.stdout.write('\n')
process.stdout.write('=== Summary ===\n')
process.stdout.write('\n')

const nameWidth = Math.max(6, ...results.map((r) => r.name.length))
const header = `${'Check'.padEnd(nameWidth)}  Status  Elapsed`
const divider = '-'.repeat(header.length)
process.stdout.write(String(header) + '\n')
process.stdout.write(String(divider) + '\n')
let totalElapsed = 0
for (const r of results) {
  totalElapsed += r.elapsed
  process.stdout.write(`${r.name.padEnd(nameWidth)}  ${r.status.padEnd(6)}  ${r.elapsed}ms
`)
}
process.stdout.write(String(divider) + '\n')
process.stdout.write(`${'Total'.padEnd(nameWidth)}          ${totalElapsed}ms
`)
process.stdout.write('\n')

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

if (failed === 0) {
  try {
    const headSha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf-8' }).trim()
    const gitUser = (() => {
      try {
        return execFileSync('git', ['config', 'user.name'], { encoding: 'utf-8' }).trim()
      } catch {
        return 'unknown'
      }
    })()
    const markerPath = resolve(GIT_CWD ?? process.cwd(), '.arbiter/gate-pass.json')
    mkdirSync(dirname(markerPath), { recursive: true })
    writeFileSync(
      markerPath,
      JSON.stringify(
        {
          head_sha: headSha,
          timestamp: new Date().toISOString(),
          level,
          node_version: process.version,
          git_user: gitUser,
        },
        null,
        2,
      ) + '\n',
    )
  } catch (err) {
    process.stderr.write(`check-all: warning: could not write gate marker: ${err.message}\n`)
  }
}

if (failed > 0) {
  console.error(`=== FAILED: ${failed} check(s) ===\n`)
  process.exit(1)
} else {
  process.stdout.write('=== ALL PASSED ===\n\n')
}
