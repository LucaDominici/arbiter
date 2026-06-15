#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// CATALOG: anti-fake-green AGGREGATE (#1412). Runs the anti-fake-green guard set and computes one
// CATALOG:   disarm-proof verdict: a child's exit 2 (broken guard) FAILS the aggregate
// CATALOG:   unconditionally — you cannot disarm a guard by breaking it. file-scan child exit 1 =
// CATALOG:   hard fail; gh-audit child exit 1 = advisory (fails only under --enforce).
// CATALOG: Rejected fold-in into check-all.mjs: the file-scan/gh-audit/broken taxonomy and the
// CATALOG:   exit-2-fails rule cannot be expressed by check-all's flat runCheck list.
// Exit codes per INV-53: 0=PASS, 1=FAIL (hard/broken, or advisory under --enforce), 2=ERROR (self).
// Usage: node scripts/check-anti-fake-green.mjs [--enforce] [--help]
import { spawnSync } from 'node:child_process'

const args = process.argv.slice(2)
if (args.includes('--help') || args.includes('-h')) {
  process.stdout.write(
    'Usage: node scripts/check-anti-fake-green.mjs [--enforce]\n  Aggregates the anti-fake-green guards; a broken guard (exit 2) always fails the aggregate.\n',
  )
  process.exit(0)
}
const enforce = args.includes('--enforce')
// class: 'file-scan' (deterministic, exit1=hard) | 'gh-audit' (remote, exit1=advisory)
const GUARDS = [
  { name: 'min-review-time', script: 'scripts/check-min-review-time.mjs', class: 'gh-audit' },
  {
    name: 'ownership-distribution',
    script: 'scripts/check-ownership-distribution.mjs',
    class: 'gh-audit',
  },
  // file-scan guards (#1412): deterministic, fail-closed; child exit 1 is a hard aggregate fail.
  // #1 muted-test — a skip/disable marker on a gate test (NO-DATA on no tests is a skip at 0).
  { name: 'muted-test', script: 'scripts/check-muted-test.mjs', class: 'file-scan' },
  // #6 skip-critical-e2e — a skipped e2e spec (NA when no e2e config exists).
  { name: 'skip-critical-e2e', script: 'scripts/check-skip-critical-e2e.mjs', class: 'file-scan' },
  // E10 no-stub-redirects — a stale "Moved →" stub .md husk (allowlist needs a hard EXPIRES).
  { name: 'no-stub-redirects', script: 'scripts/check-no-stub-redirects.mjs', class: 'file-scan' },
]

function main() {
  const broken = [],
    hardFail = [],
    advisory = [],
    pass = []
  for (const g of GUARDS) {
    const childArgs = enforce ? [g.script, '--enforce'] : [g.script]
    const r = spawnSync('node', childArgs, { encoding: 'utf-8' })
    const status = r.status
    if (status === 2 || status === null) broken.push(g.name)
    else if (status === 1) (g.class === 'file-scan' ? hardFail : advisory).push(g.name)
    else pass.push(g.name)
  }
  process.stdout.write(
    `check-anti-fake-green: pass=${pass.length} advisory=${advisory.length} hardFail=${hardFail.length} broken=${broken.length}\n`,
  )
  for (const b of broken)
    process.stderr.write(`    BROKEN (exit 2): ${b} — a broken guard fails the aggregate\n`)
  for (const h of hardFail) process.stderr.write(`    FAIL: ${h}\n`)
  for (const a of advisory) process.stderr.write(`    advisory finding: ${a}\n`)
  if (broken.length > 0 || hardFail.length > 0) return 1
  if (enforce && advisory.length > 0) return 1
  return 0
}
try {
  process.exit(main())
} catch (e) {
  process.stderr.write(`check-anti-fake-green: ERROR — ${e?.message ?? e}\n`)
  process.exit(2)
}
