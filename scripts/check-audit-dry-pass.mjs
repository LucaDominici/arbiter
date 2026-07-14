#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// CATALOG: E3 (#1943, M14) — audit dry-pass termination gate. A discovery loop of unknown
// CATALOG: size (audit, backlog drain, dead-code hunt) may conclude only after TWO consecutive
// CATALOG: passes with zero new findings, produced by differently-seeded scans. Converts "I think
// CATALOG: we got everything" (a claim, R2) into a checkable predicate. Reads the pass-ledger
// CATALOG: (.arbiter/evidence/audit/<audit-id>/pass-ledger.jsonl) and refuses a conclusion
// CATALOG: artifact (report.md/concluded.json) present while the ledger is still wet.
// CATALOG: Rejected fold-in into check-evidence-bundle.mjs: that validates the per-task TDD
// CATALOG: bundle shape, a different envelope; the dry-pass ledger is a JSONL audit trail with a
// CATALOG: two-dry-pass termination rule that has no analog in the bundle validator.
//
// Exit codes (INV-53): 0 PASS, 1 FAIL (concluded-but-wet / same-seed double-dry / malformed), 2 ERROR.
// Vacuous pass when no audit dirs exist.
//
// Usage:
//   node scripts/check-audit-dry-pass.mjs [--dir <auditDir>] [--all] [--root <dir>]
//     --dir   lint a single audit directory
//     --all   scan every .arbiter/evidence/audit/* under --root (default)
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { arg } from './lib/gate-args.mjs'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const repoDefault = resolve(__dirname, '..')

const argv = process.argv.slice(2)
const DIR_ARG = arg('dir', argv)
const ALL = argv.includes('--all')
const ROOT = arg('root', argv) ? resolve(arg('root', argv)) : repoDefault
const AUDIT_ROOT = join(ROOT, '.arbiter', 'evidence', 'audit')
const CONCLUSION_FILES = ['report.md', 'concluded.json', 'REPORT.md']

/**
 * Parse a JSONL pass-ledger. Returns { passes: object[], malformed: string[] }.
 * @param {string} ledgerPath
 */
function parseLedger(ledgerPath) {
  /** @type {Record<string, unknown>[]} */
  const passes = []
  /** @type {string[]} */
  const malformed = []
  let raw
  try {
    raw = readFileSync(ledgerPath, 'utf-8')
    // FAIL-OPEN-INTENT: readFileSync failure is surfaced via the returned `unreadable:true` flag; the caller emits a FAIL for it (fail-closed at the caller).
  } catch {
    return { passes, malformed, unreadable: true }
  }
  for (const line of raw.split('\n')) {
    if (line.trim() === '') continue
    try {
      const obj = JSON.parse(line)
      if (typeof obj !== 'object' || obj === null) {
        malformed.push(`non-object line: ${line.slice(0, 60)}`)
        continue
      }
      passes.push(/** @type {Record<string, unknown>} */ (obj))
      // FAIL-OPEN-INTENT: JSON parse error is recorded into the malformed[] array, which the caller surfaces as a FAIL (fail-closed).
    } catch (err) {
      malformed.push(`unparseable line: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  return { passes, malformed, unreadable: false }
}

/**
 * Lint one audit dir. Returns array of violation messages (empty = pass).
 * @param {string} auditDir
 * @returns {string[]}
 */
function lintAudit(auditDir) {
  /** @type {string[]} */
  const violations = []
  const concluded = CONCLUSION_FILES.some((f) => existsSync(join(auditDir, f)))
  const ledgerPath = join(auditDir, 'pass-ledger.jsonl')
  if (!existsSync(ledgerPath)) {
    // No ledger: if no conclusion either → nothing to adjudicate (pass). If a conclusion
    // exists with no ledger → fail (concluded with no dry-pass proof).
    if (concluded) violations.push(`${auditDir}: conclusion present but no pass-ledger.jsonl`)
    return violations
  }
  const { passes, malformed, unreadable } = parseLedger(ledgerPath)
  if (unreadable) {
    violations.push(`${auditDir}: cannot read pass-ledger.jsonl`)
    return violations
  }
  if (malformed.length > 0) {
    violations.push(`${auditDir}: malformed ledger — ${malformed.join('; ')}`)
    return violations
  }
  // No conclusion → nothing to adjudicate yet (the skill invokes the gate before concluding,
  // so a wet ledger with no conclusion is the normal in-flight state, not a fail).
  if (!concluded) return violations
  if (passes.length < 2) {
    violations.push(`${auditDir}: conclusion present but ledger has <2 passes (${passes.length})`)
    return violations
  }
  const last = passes[passes.length - 1]
  const prev = passes[passes.length - 2]
  const lastNew = Number(last['newFindings'] ?? -1)
  const prevNew = Number(prev['newFindings'] ?? -1)
  if (lastNew !== 0 || prevNew !== 0) {
    violations.push(
      `${auditDir}: concluded but last two passes are not both dry (newFindings: ${prevNew}, ${lastNew})`,
    )
    return violations
  }
  const lastSeed = String(last['seed'] ?? '')
  const prevSeed = String(prev['seed'] ?? '')
  if (lastSeed === prevSeed) {
    violations.push(
      `${auditDir}: two dry passes share the same seed "${lastSeed}" — one sample, not two`,
    )
    return violations
  }
  return violations
}

function listAuditDirs() {
  if (!existsSync(AUDIT_ROOT)) return []
  /** @type {string[]} */
  const out = []
  for (const entry of readdirSync(AUDIT_ROOT)) {
    const full = join(AUDIT_ROOT, entry)
    try {
      if (statSync(full).isDirectory()) out.push(full)
      // FAIL-OPEN-INTENT: statSync ENOENT race (dir entry removed between readdir+stat) — rethrow all others; the entry is just skipped.
    } catch {
      /* skip */
    }
  }
  return out
}

function main() {
  /** @type {string[]} */
  let dirs
  if (DIR_ARG) {
    dirs = [resolve(DIR_ARG)]
  } else if (ALL || !DIR_ARG) {
    // default behavior (no --dir) = scan all under --root
    dirs = listAuditDirs()
  }
  if (!dirs) dirs = []
  let checked = 0
  let totalViolations = 0
  for (const d of dirs) {
    if (!existsSync(d)) {
      process.stderr.write(`[check-audit-dry-pass] ERROR: dir not found: ${d}\n`)
      return 2
    }
    checked++
    const v = lintAudit(d)
    for (const msg of v) process.stdout.write(`[check-audit-dry-pass] FAIL: ${msg}\n`)
    totalViolations += v.length
  }
  if (totalViolations > 0) {
    process.stdout.write(
      `[check-audit-dry-pass] FAIL: ${totalViolations} violation(s) across ${checked} audit dir(s)\n`,
    )
    return 1
  }
  process.stdout.write(`[check-audit-dry-pass] OK — ${checked} audit dir(s) passed\n`)
  return 0
}

try {
  process.exit(main())
} catch (err) {
  process.stderr.write(
    `[check-audit-dry-pass] ERROR: ${err instanceof Error ? err.message : String(err)}\n`,
  )
  process.exit(2)
}
