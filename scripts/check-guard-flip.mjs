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
// CATALOG: CANON-24 / #2301 widens the completeness surface beyond the anti-fake-green roster to
// CATALOG:   the ABSENCE-ASSERTING gate family derived from scripts/check-all.mjs (check-no-*,
// CATALOG:   ratchets, parity). Those are the gates where "nothing found" and "nothing looked at"
// CATALOG:   produce the same green, so a blind one is invisible by construction. Each family
// CATALOG:   member must carry a flip proof here or a BANKED row in the deferral ledger
// CATALOG:   (scripts/data/inversion-proof-registry.json) — banked meaning ledger length ==
// CATALOG:   declared ceiling, so a NEW family gate cannot be waved through by appending a row.
// Exit codes per INV-53: 0=PASS (all guards discriminate + complete), 1=FAIL (a vacuous or
//   uncovered guard, or an unsound deferral ledger), 2=ERROR (self).
// Usage: node scripts/check-guard-flip.mjs [--gate=path] [--registry=path] [--now=YYYY-MM-DD] [--help]
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { GUARDS, CONTEXT_ROT_GATES } from './lib/anti-fake-green-guards.mjs'
import { FLIP_REGISTRY } from './lib/guard-flip-registry.mjs'
import { V } from './lib/anti-fake-green-core.mjs'
import { isMainModule } from './lib/run-helpers.mjs'
import {
  deriveAbsenceFamily,
  auditInversionRegistry,
  flipProofFor,
  INVERSION_REGISTRY_PATH,
} from './lib/gate-roster.mjs'

// Completeness surface = the aggregate roster PLUS the anti-context-rot gate roster
// (E1-E7 #1943, M11): the latter is aggregate-exempt (bespoke argv, already wired
// advisory in check-all) but its discrimination proof is enforced identically here.
const BASE_ROSTER = [...GUARDS, ...CONTEXT_ROT_GATES]

const args = process.argv.slice(2)
const flag = (name, fallback) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`))
  return hit === undefined ? fallback : hit.slice(name.length + 3)
}
if (args.includes('--help') || args.includes('-h')) {
  process.stdout.write(
    'Usage: node scripts/check-guard-flip.mjs\n' +
      '  Proves every anti-fake-green guard discriminates: each must REJECT a planted bad fixture\n' +
      '  (exit 1) and ACCEPT a clean one (exit 0). A guard in the roster with no flip-proof here is\n' +
      '  presumed vacuous and FAILS — so a newly-added always-green guard cannot slip into CI.\n' +
      '  The roster also covers the CANON-24 absence-asserting family (check-no-*, ratchets,\n' +
      '  parity) derived from check-all.mjs; each member needs a proof or a banked deferral row.\n' +
      '\n' +
      'Options:\n' +
      '  --gate=<path>      check-all.mjs to derive the absence family from\n' +
      '  --registry=<path>  deferral ledger (default scripts/data/inversion-proof-registry.json)\n' +
      '  --now=YYYY-MM-DD   clock used for deferral expiry\n' +
      '  --help, -h         show this help and exit\n',
  )
  process.exit(0)
}

/** Run a guard once against a freshly-built fixture dir; return its exit status. */
function runGuard(guard, entry, plant) {
  const dir = mkdtempSync(join(tmpdir(), 'guard-flip-'))
  try {
    plant(dir)
    const scriptPath = resolve(guard.script)
    // argv → bespoke flags built from the fixture dir (anti-context-rot gates, #1943);
    // inject 'dir' → pass --dir; inject 'cwd' → run the guard FROM the fixture dir (guards that
    // read package.json / .github from process.cwd() with no --dir flag).
    const spawnArgs =
      typeof entry.argv === 'function'
        ? [scriptPath, ...entry.argv(dir)]
        : entry.inject === 'dir'
          ? [scriptPath, '--dir', dir]
          : [scriptPath]
    const cwd = entry.inject === 'cwd' ? dir : process.cwd()
    // env → the guard reads its scan root from an env var (ARBITER_HOOK_GIT_CWD); without this
    // the fixture is invisible to it and its "clean" run would just be the live repo.
    const env =
      typeof entry.env === 'function' ? { ...process.env, ...entry.env(dir) } : process.env
    const r = spawnSync('node', spawnArgs, { encoding: 'utf-8', cwd, env })
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

/**
 * The CANON-24 half: derive the absence-asserting family from check-all.mjs, audit the deferral
 * ledger against it, and return the family members that still owe a flip proof. Fail-closed — an
 * unreadable gate source or ledger is an ERROR, never an empty family that would silently prove
 * nothing (a zero-length programme is exactly the blindness this gate exists to catch, #2301
 * corollary 2: assert programme membership BEFORE content).
 */
function absenceSurface() {
  const gatePath = resolve(flag('gate', 'scripts/check-all.mjs'))
  const registryPath = resolve(flag('registry', INVERSION_REGISTRY_PATH))
  const now = flag('now') ? new Date(`${flag('now')}T00:00:00Z`) : new Date()

  let gateSrc
  try {
    gateSrc = readFileSync(gatePath, 'utf-8')
  } catch (err) {
    throw Object.assign(new Error(`cannot read gate source ${gatePath}: ${err.message}`), {
      exitCode: 2,
    })
  }
  let registry
  try {
    registry = JSON.parse(readFileSync(registryPath, 'utf-8'))
  } catch (err) {
    throw Object.assign(new Error(`cannot read deferral ledger ${registryPath}: ${err.message}`), {
      exitCode: 2,
    })
  }

  const family = deriveAbsenceFamily(gateSrc)
  const problems = auditInversionRegistry({ family, registry, now })
  const deferred = new Set(registry.deferred.map((d) => d?.gate))
  const owing = family.filter((f) => !deferred.has(f.name))
  return { family, deferred, owing, problems }
}

function main() {
  const { family, deferred, owing, problems } = absenceSurface()
  // Absence-family members are appended to the roster under their own check-all name; those with a
  // banked deferral row are held out (they are accounted for, not proven).
  const roster = [...BASE_ROSTER, ...owing]

  const uncovered = []
  const vacuous = []
  let proven = 0
  for (const guard of roster) {
    const entry = flipProofFor(guard, FLIP_REGISTRY, BASE_ROSTER)
    if (!entry) {
      uncovered.push(guard.name)
      continue
    }
    const failures = flipGuard(guard, entry)
    if (failures.length > 0) vacuous.push({ name: guard.name, failures })
    else proven++
  }

  process.stdout.write(
    `check-guard-flip: proven=${proven} vacuous=${vacuous.length} uncovered=${uncovered.length} ` +
      `(of ${roster.length}); absence-family=${family.length} deferred=${deferred.size} ` +
      `ledger-problems=${problems.length}\n`,
  )
  for (const u of uncovered)
    process.stderr.write(
      `    UNCOVERED: ${u} — no flip-proof in scripts/lib/guard-flip-registry.mjs; a guard with no\n` +
        `      discrimination proof is presumed vacuous. Register a planted bad+clean fixture for it,\n` +
        `      or (CANON-24 absence family only) bank a row in ${INVERSION_REGISTRY_PATH}.\n`,
    )
  for (const v of vacuous)
    for (const f of v.failures) process.stderr.write(`    VACUOUS: ${v.name} — ${f}\n`)
  for (const p of problems) process.stderr.write(`    LEDGER: ${p}\n`)

  return uncovered.length > 0 || vacuous.length > 0 || problems.length > 0 ? 1 : 0
}

// Auto-run only when invoked directly (not when imported by the self-test).
const invokedDirectly = isMainModule(import.meta.url)
if (invokedDirectly) {
  try {
    process.exit(main())
  } catch (e) {
    process.stderr.write(`check-guard-flip: ERROR — ${e?.stack ?? e?.message ?? e}\n`)
    process.exit(2)
  }
}
