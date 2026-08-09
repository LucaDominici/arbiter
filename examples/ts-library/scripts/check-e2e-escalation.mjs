#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// CATALOG: #2043 (AC-2043.5/6) enforcement. Reads the append-only e2e reliability
// CATALOG:   ledger (.arbiter/e2e-ledger.jsonl, written by lib/e2e-reliability.mjs's
// CATALOG:   appendLedger) and escalates when the TRAILING run of consecutive
// CATALOG:   REGRESSION entries reaches the configured threshold — the cross-run
// CATALOG:   counterpart to the ship tick prompt's within-run strike count (#2043
// CATALOG:   AC-2043.4). Configured via arbiter.json's e2ePolicy.escalation.maxStrikes
// CATALOG:   (schema-validated, src/config/schema.ts); absent config falls back to the
// CATALOG:   pre-#2043 hardcoded 2-strike default so existing/ungoverned projects keep
// CATALOG:   their current behavior. SKIP when the ledger doesn't exist yet (no runs
// CATALOG:   recorded) or is empty.
// Exit codes (INV-53): 0=PASS/SKIP, 1=escalation triggered
// Usage: node scripts/check-e2e-escalation.mjs [--help]
import { readFileSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'

const ROOT = resolve(process.cwd())
const LEDGER_PATH = join(ROOT, '.arbiter', 'e2e-ledger.jsonl')
const ARBITER_PATH = join(ROOT, 'arbiter.json')
// Pre-#2043 hardcoded behavior (was the ship tick prompt's undeclared "2-strike" rule) —
// the default when a project has not opted into e2ePolicy.escalation.
const DEFAULT_MAX_STRIKES = 2

const HELP = `Usage: node scripts/check-e2e-escalation.mjs [--help]

Reads .arbiter/e2e-ledger.jsonl (append-only e2e reliability ledger) and escalates
when the TRAILING run of consecutive REGRESSION entries reaches the configured
e2ePolicy.escalation.maxStrikes (default ${DEFAULT_MAX_STRIKES}).

SKIP:
  When .arbiter/e2e-ledger.jsonl is absent or empty (no runs recorded yet).

Exit codes:
  0 — pass or SKIP (below threshold / no ledger)
  1 — escalation triggered (consecutive REGRESSION count >= threshold)`

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  process.stdout.write(`${HELP}\n`)
  process.exit(0)
}

// Reads+parses arbiter.json. Returns the configured maxStrikes, or the default when
// arbiter.json is absent, unreadable, malformed, or doesn't declare e2ePolicy — this
// gate degrades gracefully rather than hard-failing on a config problem another gate
// (check-smoke-journeys, schema validation) already owns reporting.
function loadMaxStrikes() {
  if (!existsSync(ARBITER_PATH)) return DEFAULT_MAX_STRIKES

  let raw
  try {
    raw = JSON.parse(readFileSync(ARBITER_PATH, 'utf-8'))
    // FAIL-OPEN-INTENT: malformed arbiter.json defaults to DEFAULT_MAX_STRIKES; schema validation owns reporting.
  } catch {
    return DEFAULT_MAX_STRIKES
  }

  const maxStrikes = raw?.e2ePolicy?.escalation?.maxStrikes
  return typeof maxStrikes === 'number' && Number.isInteger(maxStrikes) && maxStrikes >= 2
    ? maxStrikes
    : DEFAULT_MAX_STRIKES
}

// Loads the ledger as an array of parsed JSONL entries. Returns null when the ledger
// file doesn't exist (SKIP path); malformed lines are dropped rather than fail-closed —
// the ledger is an observability artifact, not a policy input, so a single corrupt
// line should not itself block the run.
function loadLedgerEntries() {
  if (!existsSync(LEDGER_PATH)) return null
  const raw = readFileSync(LEDGER_PATH, 'utf-8')
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line)
        // FAIL-OPEN-INTENT: a corrupt ledger line is dropped, not fatal — observability data, not policy input.
      } catch {
        return null
      }
    })
    .filter((entry) => entry !== null)
}

// Counts REGRESSION entries from the TAIL of the ledger, stopping at the first
// non-REGRESSION (PASS/FLAKE/INFRA) entry — only a CONSECUTIVE run counts.
function countTrailingRegressions(entries) {
  let count = 0
  for (let i = entries.length - 1; i >= 0; i--) {
    if (entries[i]?.verdict !== 'REGRESSION') break
    count++
  }
  return count
}

function main() {
  const entries = loadLedgerEntries()
  if (entries === null || entries.length === 0) {
    process.stdout.write('[check-e2e-escalation] SKIP — no e2e ledger found\n')
    process.exit(0)
  }

  const maxStrikes = loadMaxStrikes()
  const consecutive = countTrailingRegressions(entries)

  if (consecutive >= maxStrikes) {
    process.stderr.write(
      `[check-e2e-escalation] FAIL — escalation triggered: ${consecutive} consecutive ` +
        `REGRESSION ledger entries >= threshold ${maxStrikes} — force the full suite / ` +
        `escalate to needs-human per e2ePolicy.escalation\n`,
    )
    process.exit(1)
  }

  process.stdout.write(
    `[check-e2e-escalation] OK — ${consecutive} consecutive REGRESSION entries below threshold ${maxStrikes}\n`,
  )
  process.exit(0)
}

try {
  main()
} catch (err) {
  process.stderr.write(`[check-e2e-escalation] ERROR — unexpected: ${err.message}\n`)
  process.exit(2)
}
