#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// CATALOG: anti-fake-green #10 / O-9 — ownership-concentration guard. Flags single-owner
// CATALOG:   governance theater: % of open P0/P1 issues unassigned OR held by the EMPIRICALLY
// CATALOG:   dominant assignee > threshold (default 30%). Owner-agnostic: a configured --owner
// CATALOG:   that matches nothing yields NO-DATA, never PASS (NF-2/TC-1 defense). trunk-solo+ADR-091 exempt.
// CATALOG: Rejected fold-in into check-min-review-time (review signal, not ownership) and into
// CATALOG:   any gen-gap/debt script (those track items, not assignee concentration).
// Exit codes per INV-53: 0=PASS/advisory, 1=FAIL (--enforce + violation), 2=ERROR. NO-DATA=0.
// Usage: node scripts/check-ownership-distribution.mjs [--threshold PCT] [--owner LOGIN] [--enforce] [--json [path]] [--help]
import { ghAvailable, ghJson, detectSoloExempt, guardArgs, emitJson } from './lib/gh-audit-io.mjs'
import { classifyOwnership, V } from './lib/anti-fake-green-core.mjs'

const { args, opt, enforce } = guardArgs()
if (args.includes('--help') || args.includes('-h')) {
  process.stdout.write(
    'Usage: node scripts/check-ownership-distribution.mjs [--threshold PCT] [--owner LOGIN] [--labels csv] [--enforce] [--json [path]]\n' +
      '  Flags single-owner governance theater (O-9). Advisory by default; --enforce makes a violation fail.\n' +
      '  Scores the empirically dominant owner; --owner is only a NO-DATA cross-check, never a pass-maker.\n',
  )
  process.exit(0)
}
const cfg = {
  threshold: Number(opt('--threshold', 30)),
  ownerHint: opt('--owner', null),
  priorityLabels: opt('--labels', 'P0,P1,priority:P0,priority:P1').split(','),
}

function main() {
  if (!ghAvailable()) {
    process.stdout.write('check-ownership-distribution: SKIP — gh not available (NO-DATA)\n')
    return 0
  }
  if (detectSoloExempt()) {
    process.stdout.write('check-ownership-distribution: EXEMPT — trunk-solo attested (ADR-091)\n')
    return 0
  }
  const repoArgs = opt('--repo', null) ? ['--repo', opt('--repo', null)] : []
  const list = ghJson([
    'issue',
    'list',
    ...repoArgs,
    '--state',
    'open',
    '--limit',
    '1000',
    '--json',
    'number,assignees,labels',
  ])
  if (!list.ok) {
    process.stdout.write(`check-ownership-distribution: SKIP — ${list.reason} (NO-DATA)\n`)
    return 0
  }
  const res = classifyOwnership(list.data, cfg)
  emitJson(args, opt, { guard: 'ownership-distribution', ...res })
  process.stdout.write(`check-ownership-distribution: ${res.verdict} — ${res.reason}\n`)
  return enforce && res.verdict === V.VIOLATION ? 1 : 0
}
try {
  process.exit(main())
} catch (e) {
  process.stderr.write(`check-ownership-distribution: ERROR — ${e?.message ?? e}\n`)
  process.exit(2)
}
