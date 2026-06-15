#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// CATALOG: anti-fake-green #9 — review-effort guard. Flags merges with NO non-author approval
// CATALOG:   AND a sub-threshold merge window (code 4h / doc-only 1h): "review was decorative".
// CATALOG:   Uses gh latestReviews (current state per reviewer), never the stale reviews[] log.
// CATALOG:   Exempts: min-review-exempt label, dependabot patch/minor, trunk-solo+ADR-091.
// CATALOG: Rejected fold-in into check-ownership-distribution (different signal: review vs owners)
// CATALOG:   and into check-anti-proforma (test-body proforma, not merge-process theater).
// Exit codes per INV-53: 0=PASS/advisory, 1=FAIL (--enforce + violations), 2=ERROR. NO-DATA=0.
// Usage: node scripts/check-min-review-time.mjs [--pr N] [--limit N] [--enforce] [--json [path]] [--help]
import { ghAvailable, ghJson, detectSoloExempt, guardArgs, emitJson } from './lib/gh-audit-io.mjs'
import { classifyReview, V } from './lib/anti-fake-green-core.mjs'

const { args, opt, enforce } = guardArgs()
if (args.includes('--help') || args.includes('-h')) {
  process.stdout.write(
    'Usage: node scripts/check-min-review-time.mjs [--pr N] [--limit N] [--code-window-hours H] [--doc-window-hours H] [--enforce] [--json [path]]\n' +
      '  Flags same-day / no-real-review merges. Advisory by default; --enforce makes violations fail.\n' +
      '  NO-DATA (gh missing/empty) is a skip at exit 0, never a pass.\n',
  )
  process.exit(0)
}
const cfg = {
  codeWindowHours: Number(opt('--code-window-hours', 4)),
  docWindowHours: Number(opt('--doc-window-hours', 1)),
}
const PR_FIELDS = 'number,author,title,mergedAt,createdAt,isDraft,labels,files,latestReviews'

function main() {
  if (!ghAvailable()) {
    process.stdout.write('check-min-review-time: SKIP — gh not available (NO-DATA)\n')
    return 0
  }
  if (detectSoloExempt()) {
    process.stdout.write('check-min-review-time: EXEMPT — trunk-solo attested (ADR-091)\n')
    return 0
  }
  const repoArgs = opt('--repo', null) ? ['--repo', opt('--repo', null)] : []
  let prNumbers = []
  const single = opt('--pr', null)
  if (single) prNumbers = [single]
  else {
    const list = ghJson([
      'pr',
      'list',
      ...repoArgs,
      '--state',
      'merged',
      '--limit',
      opt('--limit', '30'),
      '--json',
      'number',
    ])
    if (!list.ok) {
      process.stdout.write(`check-min-review-time: SKIP — ${list.reason} (NO-DATA)\n`)
      return 0
    }
    prNumbers = list.data.map((p) => String(p.number))
  }
  const results = []
  for (const n of prNumbers) {
    const r = ghJson(['pr', 'view', n, ...repoArgs, '--json', PR_FIELDS])
    if (!r.ok) results.push({ number: n, verdict: V.NV, reason: r.reason })
    else results.push({ number: Number(n), ...classifyReview(r.data, cfg) })
  }
  results.sort((a, b) => Number(a.number) - Number(b.number))
  const violations = results.filter((r) => r.verdict === V.VIOLATION)
  emitJson(args, opt, { guard: 'min-review-time', results })
  process.stdout.write(
    `check-min-review-time: ${results.length} PR(s); ${violations.length} violation(s) (advisory${enforce ? '+enforce' : ''})\n`,
  )
  for (const v of violations) process.stderr.write(`    VIOLATION PR #${v.number}: ${v.reason}\n`)
  return enforce && violations.length > 0 ? 1 : 0
}
try {
  process.exit(main())
} catch (e) {
  process.stderr.write(`check-min-review-time: ERROR — ${e?.message ?? e}\n`)
  process.exit(2)
}
