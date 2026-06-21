#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// CATALOG: anti-fake-green grace-window guard (#1491). The ADR-028 grace period turns a freshly
// CATALOG:   upgraded L1→L2 project's L2 gates WARN-only for a bounded settling window. Two edits
// CATALOG:   to arbiter.json could otherwise neuter the L2 gate indefinitely:
// CATALOG:     (1) an over-long graceEndsAt (hand-edited far-future date), and
// CATALOG:     (2) a stale graceFromLevel=L1 carried into a project that has since climbed to L3/L4
// CATALOG:         (grace from L1 must only ever soften L2, never a higher gate).
// CATALOG:   check-all.mjs already refuses to honor either at run time; THIS guard is the static
// CATALOG:   regression detector so a poisoned arbiter.json is caught by the anti-fake-green
// CATALOG:   aggregate even if the gate is bypassed. NO-DATA (no arbiter.json / no active grace) is
// CATALOG:   a PASS, never a manufactured fail.
// CATALOG: Rejected fold-in into check-all.mjs (run-time soft-coerce) and the doctor command
// CATALOG:   (interactive health report, not a fail-closed CI guard) — different axis.
// Exit codes per INV-53: 0=PASS, 1=FAIL (over-long / stale-level grace), 2=ERROR (self).
// Usage: node scripts/check-grace-window.mjs [--dir <path>] [--max-days <n>] [--help]
import { readFileSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'

const args = process.argv.slice(2)
if (args.includes('--help') || args.includes('-h')) {
  process.stdout.write(
    'Usage: node scripts/check-grace-window.mjs [--dir <path>] [--max-days <n>]\n' +
      '  Fails when arbiter.json carries an over-long ADR-028 grace window (graceEndsAt more than\n' +
      '  --max-days ahead of now) or a stale graceFromLevel=L1 on a project now above L2.\n' +
      '  NO-DATA (no arbiter.json or no active grace) is a PASS.\n',
  )
  process.exit(0)
}

const dirIdx = args.indexOf('--dir')
const ROOT = dirIdx >= 0 && args[dirIdx + 1] ? resolve(args[dirIdx + 1]) : process.cwd()
const maxIdx = args.indexOf('--max-days')
// Must match GRACE_MAX_DAYS in src/templates/scripts/check-all.mjs.ejs (upgrade-level default 30
// + 5 slack for one --extend). Keep the two in lockstep.
const MAX_DAYS = maxIdx >= 0 && args[maxIdx + 1] ? Number(args[maxIdx + 1]) : 35

function main() {
  const cfgPath = join(ROOT, 'arbiter.json')
  if (!existsSync(cfgPath)) {
    process.stdout.write('check-grace-window: NO-DATA (no arbiter.json) — PASS\n')
    return 0
  }

  let cfg
  try {
    cfg = JSON.parse(readFileSync(cfgPath, 'utf-8'))
  } catch (e) {
    process.stderr.write(
      `check-grace-window: ERROR — arbiter.json is unreadable (${e?.message ?? e})\n`,
    )
    return 2
  }

  if (cfg.graceFromLevel !== 'L1' || !cfg.graceEndsAt) {
    process.stdout.write('check-grace-window: NO-DATA (no active L1→L2 grace) — PASS\n')
    return 0
  }

  const ends = Date.parse(cfg.graceEndsAt)
  const now = Date.now()
  if (!Number.isFinite(ends) || ends <= now) {
    // Expired or malformed grace is inert (check-all ignores it) — nothing to flag.
    process.stdout.write('check-grace-window: grace expired or inert — PASS\n')
    return 0
  }

  const findings = []
  // (2) Stale-level grace: graceFromLevel=L1 but project has climbed above L2.
  if (cfg.governanceLevel && cfg.governanceLevel !== 'L2') {
    findings.push(
      `stale grace: graceFromLevel=L1 but governanceLevel=${cfg.governanceLevel} — an L1→L2 grace must ` +
        `not soften an ${cfg.governanceLevel} gate. Clear graceFromLevel/graceEndsAt from arbiter.json.`,
    )
  }
  // (1) Over-long window: graceEndsAt beyond the bound = hand-extended fake-green vector.
  const daysAhead = Math.ceil((ends - now) / 86400000)
  if (daysAhead > MAX_DAYS) {
    findings.push(
      `over-long grace: graceEndsAt is ${daysAhead} days ahead (bound ${MAX_DAYS}). A hand-edited ` +
        `far-future date neuters the L2 gate. Re-run \`arbiter upgrade-level --extend\` instead.`,
    )
  }

  if (findings.length > 0) {
    process.stderr.write('check-grace-window: FAIL — grace window is a fake-green vector:\n')
    for (const f of findings) process.stderr.write(`    ${f}\n`)
    return 1
  }

  process.stdout.write(
    `check-grace-window: grace ends in ${daysAhead} day(s), within the ${MAX_DAYS}-day bound — PASS\n`,
  )
  return 0
}

try {
  process.exit(main())
} catch (e) {
  process.stderr.write(`check-grace-window: ERROR — ${e?.message ?? e}\n`)
  process.exit(2)
}
