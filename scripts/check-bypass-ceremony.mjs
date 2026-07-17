#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// CATALOG: E4 (#1943/#1949, M15b) — bypass ceremony detector. Two detectors, one axis
// CATALOG: (enforcement theater): (a) bypass-rate ceiling — a gate bypassed more than N
// CATALOG: times/month via .arbiter/evidence/bypass-log.jsonl is flagged for demotion or
// CATALOG: deletion; (b) advisory-permanent — every runWarnCheck(...) call site in
// CATALOG: scripts/check-all.mjs must have a scripts/data/advisory-ledger.json entry with a
// CATALOG: future promoteBy or permanent:true + rationale (the dated-debt discipline of
// CATALOG: suppressions expiry, INV-31, applied to the gate roster itself).
// CATALOG: Rejected fold-in into check-suppressions.mjs: that lints suppression *comments*
// CATALOG: with a different required-field shape (owner/scope), not the gate roster; rejected
// CATALOG: fold-in into check-audit-dry-pass.mjs: shares the JSONL-ledger shape but a wholly
// CATALOG: different predicate (dry-pass termination vs bypass-rate ceiling).
//
// Exit codes (INV-53): 0 PASS, 1 FAIL (ceiling exceeded / ledger entry missing or expired /
// malformed input), 2 ERROR (invocation/IO failure outside the audited files themselves).
// Vacuous pass when no bypass-log exists and check-all.mjs has no runWarnCheck sites.
//
// Usage:
//   node scripts/check-bypass-ceremony.mjs [--root <dir>] [--json]
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { arg } from './lib/gate-args.mjs'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const repoDefault = resolve(__dirname, '..')

const argv = process.argv.slice(2)
const ROOT = arg('root', argv) ? resolve(arg('root', argv)) : repoDefault
const JSON_OUT = argv.includes('--json')

const BYPASS_LOG_PATH = join(ROOT, '.arbiter', 'evidence', 'bypass-log.jsonl')
const THRESHOLDS_PATH = join(ROOT, 'scripts', 'data', 'ceremony-thresholds.json')
const CHECK_ALL_PATH = join(ROOT, 'scripts', 'check-all.mjs')
const LEDGER_PATH = join(ROOT, 'scripts', 'data', 'advisory-ledger.json')
const ARBITER_CONFIG_PATH = join(ROOT, 'arbiter.json')

const WINDOW_DAYS = 30
const DEFAULT_CEILING = 12
const SOLO_DEFAULT_CEILING = 20

/**
 * Resolve whether this repo runs under trunk-solo collaboration mode, best-effort. An
 * unreadable/absent arbiter.json resolves to false (non-solo) — the stricter ceiling —
 * which is the fail-closed direction for a ceiling gate (uncertainty never widens budget).
 * @returns {boolean}
 */
function isSoloMode() {
  if (!existsSync(ARBITER_CONFIG_PATH)) return false
  try {
    const cfg = JSON.parse(readFileSync(ARBITER_CONFIG_PATH, 'utf-8'))
    if (cfg.collaborationMode) return cfg.collaborationMode === 'trunk-solo'
    return cfg.enableSoloDevMode === true || cfg?.features?.soloDevMode === true
    // FAIL-OPEN-INTENT: malformed arbiter.json defaults to non-solo, the stricter ceiling — fail-closed, not fail-open.
  } catch {
    return false
  }
}

/**
 * Load ceiling thresholds. Returns { default, overrides } with built-in fallbacks when the
 * data file is absent or malformed (fail-closed: falls back to the documented defaults,
 * never to "no ceiling").
 * @returns {{ default: number, overrides: Record<string, number> }}
 */
function loadThresholds() {
  const solo = isSoloMode()
  const builtinDefault = solo ? SOLO_DEFAULT_CEILING : DEFAULT_CEILING
  if (!existsSync(THRESHOLDS_PATH)) return { default: builtinDefault, overrides: {} }
  try {
    const raw = JSON.parse(readFileSync(THRESHOLDS_PATH, 'utf-8'))
    const base = solo && typeof raw.soloDefault === 'number' ? raw.soloDefault : raw.default
    return {
      default: typeof base === 'number' ? base : builtinDefault,
      overrides: raw.overrides && typeof raw.overrides === 'object' ? raw.overrides : {},
    }
    // FAIL-OPEN-INTENT: malformed ceremony-thresholds.json falls back to the built-in default ceiling, never an unbounded one — fail-closed.
  } catch {
    return { default: builtinDefault, overrides: {} }
  }
}

/**
 * Parse the bypass-log JSONL. Returns { records, malformed }.
 * @returns {{ records: Record<string, unknown>[], malformed: string[] }}
 */
function parseBypassLog() {
  /** @type {Record<string, unknown>[]} */
  const records = []
  /** @type {string[]} */
  const malformed = []
  if (!existsSync(BYPASS_LOG_PATH)) return { records, malformed }
  const raw = readFileSync(BYPASS_LOG_PATH, 'utf-8')
  for (const line of raw.split('\n')) {
    if (line.trim() === '') continue
    try {
      const obj = JSON.parse(line)
      if (typeof obj !== 'object' || obj === null) {
        malformed.push(`non-object line: ${line.slice(0, 60)}`)
        continue
      }
      records.push(/** @type {Record<string, unknown>} */ (obj))
      // FAIL-OPEN-INTENT: JSON parse error is recorded into malformed[], which the caller surfaces as a FAIL (fail-closed).
    } catch (err) {
      malformed.push(`unparseable line: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  return { records, malformed }
}

/**
 * Count bypassed:true records per env within the trailing WINDOW_DAYS window.
 * @param {Record<string, unknown>[]} records
 * @returns {Record<string, number>}
 */
function countRecentBypasses(records) {
  const cutoff = Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000
  /** @type {Record<string, number>} */
  const counts = {}
  for (const rec of records) {
    if (rec.bypassed !== true) continue
    const ts = Date.parse(String(rec.ts ?? ''))
    if (Number.isNaN(ts) || ts < cutoff) continue
    const env = String(rec.env ?? 'unknown')
    counts[env] = (counts[env] ?? 0) + 1
  }
  return counts
}

/**
 * Detector (a): aggregate bypassed:true records per env over the trailing WINDOW_DAYS and
 * compare against the per-env ceiling. Returns { channels, violations }.
 * @param {Record<string, unknown>[]} records
 * @param {{ default: number, overrides: Record<string, number> }} thresholds
 */
function checkBypassRate(records, thresholds) {
  const counts = countRecentBypasses(records)
  /** @type {string[]} */
  const violations = []
  /** @type {{ env: string, count: number, ceiling: number }[]} */
  const channels = []
  for (const [env, count] of Object.entries(counts)) {
    const ceiling = thresholds.overrides[env] ?? thresholds.default
    channels.push({ env, count, ceiling })
    if (count > ceiling) {
      violations.push(
        `${env}: ${count} bypasses in the trailing ${WINDOW_DAYS} days (ceiling ${ceiling}) — demote the gate to advisory or delete it: a gate this bypassed is not a gate`,
      )
    }
  }
  return { channels, violations }
}

/**
 * Extract every runWarnCheck('name', ...) call-site name from check-all.mjs source.
 * @param {string} body
 * @returns {string[]}
 */
function extractWarnCheckSites(body) {
  const siteRe = /runWarnCheck\(\s*['"]([^'"]+)['"]/g
  /** @type {string[]} */
  const sites = []
  for (const m of body.matchAll(siteRe)) sites.push(m[1])
  return sites
}

/**
 * Load the advisory ledger entries as a Map keyed by `check` name. A missing or malformed
 * ledger degrades to an empty map — fail-closed: every site is then reported "missing"
 * rather than silently skipped.
 * @returns {Map<string, Record<string, unknown>>}
 */
function loadLedgerByName() {
  if (!existsSync(LEDGER_PATH)) return new Map()
  try {
    const parsed = JSON.parse(readFileSync(LEDGER_PATH, 'utf-8'))
    const entries = Array.isArray(parsed.entries) ? parsed.entries : []
    return new Map(entries.map((e) => [String(e.check ?? ''), e]))
    // FAIL-OPEN-INTENT: malformed ledger degrades to an empty Map — every site then reports missing, fail-closed.
  } catch {
    return new Map()
  }
}

/**
 * Validate one runWarnCheck site's ledger entry. Returns a violation message, or null when
 * the entry satisfies the dated-debt discipline (future promoteBy, or permanent + rationale).
 * @param {string} name
 * @param {Record<string, unknown> | undefined} entry
 * @returns {string | null}
 */
function validateLedgerEntry(name, entry) {
  if (!entry)
    return `"${name}": runWarnCheck site has no scripts/data/advisory-ledger.json entry (missing)`
  if (entry.permanent === true) {
    const hasRationale = typeof entry.rationale === 'string' && entry.rationale.trim() !== ''
    return hasRationale ? null : `"${name}": permanent:true entry has no rationale`
  }
  const promoteBy = typeof entry.promoteBy === 'string' ? entry.promoteBy : ''
  const parsed = Date.parse(promoteBy)
  if (!promoteBy || Number.isNaN(parsed)) {
    return `"${name}": ledger entry missing a valid promoteBy (and not permanent:true)`
  }
  if (parsed < Date.now()) {
    return `"${name}": ledger entry promoteBy ${promoteBy} has expired (past due) — promote or extend`
  }
  return null
}

/**
 * Detector (b): every runWarnCheck('name', ...) call site in check-all.mjs must have a
 * scripts/data/advisory-ledger.json entry with a future promoteBy or permanent:true +
 * rationale. Returns { sites, violations }.
 * @returns {{ sites: string[], violations: string[] }}
 */
function checkAdvisoryPermanent() {
  if (!existsSync(CHECK_ALL_PATH)) return { sites: [], violations: [] }
  const sites = extractWarnCheckSites(readFileSync(CHECK_ALL_PATH, 'utf-8'))
  const byName = loadLedgerByName()
  const violations = sites
    .map((name) => validateLedgerEntry(name, byName.get(name)))
    .filter((v) => v !== null)
  return { sites, violations }
}

function main() {
  const { records, malformed } = parseBypassLog()
  if (malformed.length > 0) {
    for (const m of malformed)
      process.stdout.write(`[check-bypass-ceremony] FAIL: bypass-log — ${m}\n`)
    if (!JSON_OUT) {
      process.stdout.write(
        `[check-bypass-ceremony] FAIL: ${malformed.length} malformed bypass-log line(s)\n`,
      )
    }
    if (JSON_OUT) {
      process.stdout.write(JSON.stringify({ channels: [], ledgerViolations: [], malformed }) + '\n')
    }
    return 1
  }

  const thresholds = loadThresholds()
  const { channels, violations: rateViolations } = checkBypassRate(records, thresholds)
  const { violations: ledgerViolations } = checkAdvisoryPermanent()

  for (const v of rateViolations) process.stdout.write(`[check-bypass-ceremony] FAIL: ${v}\n`)
  for (const v of ledgerViolations) process.stdout.write(`[check-bypass-ceremony] FAIL: ${v}\n`)

  const total = rateViolations.length + ledgerViolations.length

  if (JSON_OUT) {
    process.stdout.write(JSON.stringify({ channels, ledgerViolations, rateViolations }) + '\n')
  } else if (total > 0) {
    process.stdout.write(`[check-bypass-ceremony] FAIL: ${total} ceremony violation(s)\n`)
  } else {
    process.stdout.write(
      `[check-bypass-ceremony] OK — ${channels.length} channel(s), all ledger sites covered\n`,
    )
  }

  return total > 0 ? 1 : 0
}

try {
  process.exit(main())
} catch (err) {
  process.stderr.write(
    `[check-bypass-ceremony] ERROR: ${err instanceof Error ? err.message : String(err)}\n`,
  )
  process.exit(2)
}
