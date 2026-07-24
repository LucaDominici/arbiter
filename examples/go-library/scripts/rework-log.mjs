#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// rework-log.mjs — rework telemetry (acceptance-anchor P4).
//
// Every redone PR / REWORK verdict is data, not noise: tag it with WHY (taxonomy) and
// WHERE it was caught (review | gate | post-merge). After 10–15 entries the report
// points at the exact issue-template section that is too loose — the pipeline becomes
// self-correcting. Ledger: .arbiter/rework/ledger.jsonl (COMMITTED — paired gitignore
// negations; merge=union via .gitattributes).
//
// Usage:
//   node scripts/rework-log.mjs add --issue N [--pr N] --reason <r> --caught <c> [--note "…"]
//   node scripts/rework-log.mjs report
//
// Exit codes (INV-53): 0 OK · 1 invalid entry · 2 usage/unexpected error
import { readFileSync, existsSync, mkdirSync, appendFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

export const REWORK_REASONS = [
  'misread-intent',
  'missing-edge-case',
  'scope-creep',
  'design-mismatch',
  'underspecified-issue',
  'flaky-infra',
  'other',
]
export const CAUGHT_STAGES = ['review', 'gate', 'post-merge']

export const LEDGER_REL_PATH = join('.arbiter', 'rework', 'ledger.jsonl')

// reason → which part of the issue template / process is too loose
const TEMPLATE_HINTS = {
  'misread-intent': 'Objective/AC wording ambiguous — tighten the Acceptance criteria field',
  'missing-edge-case': 'AC lack edge-case criteria — add explicit AC-N lines for boundaries',
  'scope-creep': 'Non-goals section absent or weak — make exclusions explicit',
  'design-mismatch': 'Files/contracts + design references missing from the issue',
  'underspecified-issue':
    'Issue skipped the readiness gate — enforce issue-readiness before dispatch',
  'flaky-infra': 'Not a template problem — track the infra flake as its own issue',
  other: 'Unclassified — review the entry notes',
}

function isPositiveInt(value) {
  return Number.isInteger(value) && value > 0
}

/** Pure entry validation; returns an error list (empty = valid). */
export function validateEntry(entry) {
  const e = entry === null || typeof entry !== 'object' ? {} : entry
  const errors = []
  if (!isPositiveInt(e.issue)) errors.push('issue: required positive integer (--issue N)')
  if (e.pr != null && !isPositiveInt(e.pr)) errors.push('pr: must be a positive integer when given')
  if (!REWORK_REASONS.includes(e.reason))
    errors.push(`reason: must be one of ${REWORK_REASONS.join('|')}`)
  if (!CAUGHT_STAGES.includes(e.caught))
    errors.push(`caught: must be one of ${CAUGHT_STAGES.join('|')}`)
  return errors
}

/** Pure aggregation over raw JSONL lines. */
export function aggregateLedger(lines) {
  const byReason = {}
  const byCaught = {}
  let total = 0
  let malformed = 0
  for (const line of lines) {
    if (!line.trim()) continue
    let entry
    try {
      entry = JSON.parse(line)
      // FAIL-OPEN-INTENT: malformed ledger lines are COUNTED (agg.malformed) and reported by `report` — skipping one line never hides the corruption.
    } catch {
      malformed += 1
      continue
    }
    total += 1
    byReason[entry.reason] = (byReason[entry.reason] ?? 0) + 1
    byCaught[entry.caught] = (byCaught[entry.caught] ?? 0) + 1
  }
  const hints = Object.entries(byReason)
    .sort((a, b) => b[1] - a[1])
    .map(([reason, count]) => `${reason} (${count}) → ${TEMPLATE_HINTS[reason] ?? '—'}`)
  return { total, malformed, byReason, byCaught, hints }
}

function parseFlags(args) {
  const out = {}
  for (let i = 0; i < args.length; i += 1) {
    const m = /^--([a-z-]+)$/.exec(args[i])
    if (m) {
      out[m[1]] = args[i + 1]
      i += 1
    }
  }
  return out
}

function headSha(cwd) {
  try {
    const r = spawnSync('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf-8' })
    return r.status === 0 ? r.stdout.trim() : null
    // FAIL-OPEN-INTENT: telemetry sha enrichment must never block recording an entry outside a git context — sha:null is the surfaced signal.
  } catch {
    return null // telemetry must never fail on a missing git context
  }
}

function runAdd(rest, root, ledgerPath) {
  const flags = parseFlags(rest)
  const entry = {
    ts: new Date().toISOString(),
    issue: flags.issue ? Number(flags.issue) : undefined,
    pr: flags.pr ? Number(flags.pr) : null,
    reason: flags.reason,
    caught: flags.caught,
    note: flags.note ?? '',
    sha: headSha(root),
  }
  const errors = validateEntry(entry)
  if (errors.length > 0) {
    for (const e of errors) process.stderr.write(`FAIL rework-log: ${e}\n`)
    return 1
  }
  mkdirSync(dirname(ledgerPath), { recursive: true })
  appendFileSync(ledgerPath, `${JSON.stringify(entry)}\n`, 'utf-8')
  console.log(`rework-log: recorded ${entry.reason}/${entry.caught} for #${entry.issue}`)
  return 0
}

function runReport(ledgerPath) {
  if (!existsSync(ledgerPath)) {
    console.log('rework-log: no rework entries recorded yet')
    return 0
  }
  const agg = aggregateLedger(readFileSync(ledgerPath, 'utf-8').split('\n'))
  console.log(
    `rework entries: ${agg.total}${agg.malformed ? ` (malformed skipped: ${agg.malformed})` : ''}`,
  )
  console.log('by caught stage:')
  for (const stage of CAUGHT_STAGES) {
    console.log(`  ${stage}: ${agg.byCaught[stage] ?? 0}`)
  }
  console.log('by reason → template hint:')
  for (const hint of agg.hints) console.log(`  ${hint}`)
  return 0
}

function main() {
  const [subcommand, ...rest] = process.argv.slice(2)
  const root = process.cwd()
  const ledgerPath = join(root, LEDGER_REL_PATH)

  if (subcommand === 'add') return runAdd(rest, root, ledgerPath)
  if (subcommand === 'report') return runReport(ledgerPath)

  process.stderr.write(
    'ERROR rework-log: usage: rework-log.mjs add --issue N [--pr N] --reason <r> --caught <c> [--note "…"] | report\n',
  )
  return 2
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    process.exit(main())
  } catch (err) {
    console.error(`ERROR rework-log: ${err instanceof Error ? err.message : String(err)}`)
    process.exit(2)
  }
}
