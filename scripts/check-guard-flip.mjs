#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// CATALOG: anti-fake-green guard-flip self-test harness (A6, #1497). A guard that always passes
// CATALOG:   (vacuous) is itself a fake-green: it attests a property it never actually tests. This
// CATALOG:   harness proves every anti-fake-green guard DISCRIMINATES — for each guard it plants a
// CATALOG:   BAD fixture the guard must REJECT (exit 1 / VIOLATION) and a CLEAN fixture it must
// CATALOG:   ACCEPT (exit 0 / PASS). A guard that passes both, or fails both, is not discriminating
// CATALOG:   and FAILS the harness. Completeness is enforced against the GUARDS SSOT
// CATALOG:   (scripts/lib/anti-fake-green-guards.mjs): a guard added to the aggregate with no
// CATALOG:   flip-proof registered here is presumed vacuous and FAILS — so a newly-added
// CATALOG:   always-green guard cannot reach CI undetected.
// CATALOG: Rejected fold-in into check-anti-fake-green.mjs: that AGGREGATES guard verdicts against
// CATALOG:   the LIVE repo; this harness instead exercises each guard on SYNTHETIC bad/clean
// CATALOG:   fixtures — a different axis (per-guard discrimination proof vs verdict aggregation).
//   Folding the synthetic-fixture machinery into the aggregate would couple every CI run to
//   tmpdir fixture I/O and conflate "is the repo clean" with "does the guard work".
// Exit codes per INV-53: 0=PASS (all guards discriminate + complete), 1=FAIL (a vacuous or
//   uncovered guard), 2=ERROR (self).
// Usage: node scripts/check-guard-flip.mjs [--help]
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { join, resolve } from 'node:path'
import { GUARDS } from './lib/anti-fake-green-guards.mjs'
import { FLIP_REGISTRY } from './lib/guard-flip-registry.mjs'
import { V } from './lib/anti-fake-green-core.mjs'

const args = process.argv.slice(2)
if (args.includes('--help') || args.includes('-h')) {
  process.stdout.write(
    'Usage: node scripts/check-guard-flip.mjs\n' +
      '  Proves every anti-fake-green guard discriminates: each must REJECT a planted bad fixture\n' +
      '  (exit 1) and ACCEPT a clean one (exit 0). A guard in the roster with no flip-proof here is\n' +
      '  presumed vacuous and FAILS — so a newly-added always-green guard cannot slip into CI.\n',
  )
  process.exit(0)
}

/** Run a guard once against a freshly-built fixture dir; return its exit status. */
function runGuard(guard, entry, plant) {
  const dir = mkdtempSync(join(tmpdir(), 'guard-flip-'))
  try {
    plant(dir)
    const scriptPath = resolve(guard.script)
    // inject 'dir' → pass --dir; inject 'cwd' → run the guard FROM the fixture dir (guards that
    // read package.json / .github from process.cwd() with no --dir flag).
    const spawnArgs = entry.inject === 'dir' ? [scriptPath, '--dir', dir] : [scriptPath]
    const cwd = entry.inject === 'cwd' ? dir : process.cwd()
    const r = spawnSync('node', spawnArgs, { encoding: 'utf-8', cwd })
    return r.status ?? 1
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

/** Flip-test one file-scan guard: bad must exit 1, clean must exit 0. */
function flipFileScan(guard, entry) {
  const failures = []
  const badStatus = runGuard(guard, entry, entry.plantBad)
  if (badStatus !== 1)
    failures.push(`accepted a planted BAD fixture (exit ${badStatus}, expected 1) — VACUOUS`)
  const cleanStatus = runGuard(guard, entry, entry.plantClean)
  if (cleanStatus !== 0)
    failures.push(`rejected a CLEAN fixture (exit ${cleanStatus}, expected 0) — over-eager`)
  return failures
}

/** Flip-test one core (gh-audit) guard via its pure classifier: bad VIOLATION, clean PASS. */
function flipCore(guard, entry) {
  const failures = []
  const { bad, clean } = entry.flip()
  if (bad !== V.VIOLATION)
    failures.push(`classified a planted BAD input as ${bad} (expected VIOLATION) — VACUOUS`)
  if (clean !== V.PASS)
    failures.push(`classified a CLEAN input as ${clean} (expected PASS) — over-eager`)
  return failures
}

/**
 * Flip-test a single guard against its registry entry. Returns the list of discrimination
 * failures (empty ⇒ the guard provably discriminates). Exported for the self-test.
 */
export function flipGuard(guard, entry) {
  return entry.kind === 'core' ? flipCore(guard, entry) : flipFileScan(guard, entry)
}

function main() {
  const uncovered = []
  const vacuous = []
  let proven = 0
  for (const guard of GUARDS) {
    const entry = FLIP_REGISTRY[guard.name]
    if (!entry) {
      uncovered.push(guard.name)
      continue
    }
    const failures = flipGuard(guard, entry)
    if (failures.length > 0) vacuous.push({ name: guard.name, failures })
    else proven++
  }

  process.stdout.write(
    `check-guard-flip: proven=${proven} vacuous=${vacuous.length} uncovered=${uncovered.length} (of ${GUARDS.length})\n`,
  )
  for (const u of uncovered)
    process.stderr.write(
      `    UNCOVERED: ${u} — no flip-proof in scripts/lib/guard-flip-registry.mjs; a guard with no\n` +
        `      discrimination proof is presumed vacuous. Register a planted bad+clean fixture for it.\n`,
    )
  for (const v of vacuous)
    for (const f of v.failures) process.stderr.write(`    VACUOUS: ${v.name} — ${f}\n`)

  return uncovered.length > 0 || vacuous.length > 0 ? 1 : 0
}

// Auto-run only when invoked directly (not when imported by the self-test).
const invokedDirectly =
  process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (invokedDirectly) {
  try {
    process.exit(main())
  } catch (e) {
    process.stderr.write(`check-guard-flip: ERROR — ${e?.stack ?? e?.message ?? e}\n`)
    process.exit(2)
  }
}
