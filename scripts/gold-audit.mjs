#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// arbiter — native-TS gold-audit engine (#1373). Reimplements the upstream reference gold-audit
// registry evaluator natively in node (zero Python dependency for consumer projects). The score is
// computed by code, never by an AI (owner hard requirement). Same repo + same registry ⇒
// byte-identical output (determinism). Wired into scripts/check-all.mjs as a no-regress gate.
//
// Reads a per-stack registry (standards/gold-registry.yml) → per-check verdict Y/P/N/NA/NV with
// evidence (file [+ line]) → an aggregate score + dimension table. Adds a monotonic ratchet
// baseline (.gold-audit-baseline.json), a no-regress merge gate (--check), and a false-gap
// meta-gate (--strict, RISKY>0 fails). The shared evaluator lives in scripts/lib/gold-audit-lib.mjs
// so the CLI, the gold-report consumer, and the tests share one code path.
//
// Exit codes (INV-53 contract): 0 PASS/advisory, 1 FAIL (regression / RISKY / stale), 2 IO error.
//
// Usage:
//   node scripts/gold-audit.mjs [--json [path]] [--check] [--strict] [--update-baseline]
//                               [--registry P] [--profile P] [--baseline P] [--help]
//     --json [P]         emit the scored payload as JSON (to stdout, or to file P)
//     --check            no-regress gate: exit 1 if score/Y dropped below the baseline
//                        (bootstraps a missing baseline and exits 0)
//     --strict           false-gap meta-gate: exit 1 if any check is RISKY
//     --update-baseline  monotonically ratchet the baseline (never lowers a field)
//     --registry P       registry path (default standards/gold-registry.yml)
//     --profile P        overlay profile path (default standards/gold-profile)
//     --baseline P       baseline path (default .gold-audit-baseline.json)
//     --help, -h         show this help

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { parse as parseYaml } from 'yaml'
import { evaluate, checkNoRegress, ratchet, baselineOf } from './lib/gold-audit-lib.mjs'

const args = process.argv.slice(2)
if (args.includes('--help') || args.includes('-h')) {
  process.stdout.write(
    [
      'Usage: node scripts/gold-audit.mjs [options]',
      '',
      'Deterministic registry→Y/P/N gold-audit engine (the score is code-computed, never AI).',
      '',
      '  --json [P]         emit the scored payload as JSON (stdout, or file P)',
      '  --check            no-regress gate: exit 1 if score/Y dropped vs baseline',
      '  --strict           false-gap meta-gate: exit 1 if any RISKY check exists',
      '  --update-baseline  monotonically ratchet the baseline (never lowers a field)',
      '  --registry P       registry path (default standards/gold-registry.yml)',
      '  --profile P        overlay profile path (default standards/gold-profile)',
      '  --baseline P       baseline path (default .gold-audit-baseline.json)',
      '  --help, -h         show this help',
      '',
    ].join('\n'),
  )
  process.exit(0)
}

const flag = (name) => args.includes(name)
const opt = (name, def) => {
  const i = args.indexOf(name)
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : def
}

const CWD = process.cwd()
const REGISTRY = opt('--registry', 'standards/gold-registry.yml')
const PROFILE = opt('--profile', 'standards/gold-profile')
const BASELINE = opt('--baseline', '.gold-audit-baseline.json')

function loadOverlays() {
  const abs = resolve(CWD, PROFILE)
  if (!existsSync(abs)) return new Set()
  try {
    const doc = parseYaml(readFileSync(abs, 'utf-8')) || {}
    return new Set(Array.isArray(doc.overlays) ? doc.overlays : [])
  } catch {
    return new Set()
  }
}

function readBaseline() {
  const abs = resolve(CWD, BASELINE)
  if (!existsSync(abs)) return null
  try {
    return JSON.parse(readFileSync(abs, 'utf-8'))
  } catch (err) {
    process.stderr.write(`gold-audit: ERROR — malformed ${BASELINE}: ${err.message}\n`)
    process.exit(2)
  }
}

function writeBaseline(payload) {
  const abs = resolve(CWD, BASELINE)
  mkdirSync(dirname(abs), { recursive: true })
  writeFileSync(abs, JSON.stringify(payload, null, 2) + '\n', 'utf-8')
}

function main() {
  const regAbs = resolve(CWD, REGISTRY)
  if (!existsSync(regAbs)) {
    process.stdout.write(`gold-audit: SKIP — no registry at ${REGISTRY}\n`)
    return 0
  }
  let registry
  try {
    registry = parseYaml(readFileSync(regAbs, 'utf-8'))
  } catch (err) {
    process.stderr.write(`gold-audit: ERROR — malformed ${REGISTRY}: ${err.message}\n`)
    return 2
  }

  const overlays = loadOverlays()
  const result = evaluate(registry, overlays, CWD)

  // --strict false-gap meta-gate: never score on a fragile (RISKY) registry.
  if (flag('--strict') && result.riskyCount > 0) {
    const risky = result.checks.filter((c) => c.risk === 'RISKY').map((c) => c.id)
    process.stderr.write(
      `gold-audit: FAIL — false-gap meta-gate: ${result.riskyCount} RISKY check(s): ${risky.join(', ')}\n`,
    )
    return 1
  }

  // --update-baseline: monotonic ratchet (can only tighten).
  if (flag('--update-baseline')) {
    const next = ratchet(result, readBaseline())
    writeBaseline(next)
    process.stdout.write(
      `gold-audit: baseline ratcheted → ${BASELINE} (score=${next.score}, Y=${next.yCount})\n`,
    )
    return 0
  }

  // --check no-regress gate.
  if (flag('--check')) {
    const baseline = readBaseline()
    if (baseline === null) {
      writeBaseline(baselineOf(result))
      process.stdout.write(
        `gold-audit: baseline initialized → ${BASELINE} (score=${result.score}, Y=${result.yCount})\n`,
      )
      return 0
    }
    if (process.env.ALLOW_GOLD_REGRESS === '1') {
      process.stdout.write('gold-audit: ALLOW_GOLD_REGRESS=1 — skipping no-regress gate\n')
      return 0
    }
    const verdict = checkNoRegress(result, baseline)
    if (!verdict.ok) {
      process.stderr.write(`gold-audit: FAIL — no-regress gate:\n`)
      for (const r of verdict.reasons) process.stderr.write(`    ${r}\n`)
      return 1
    }
    process.stdout.write(
      `gold-audit: no-regress OK (score=${result.score} >= ${baseline.score}, Y=${result.yCount} >= ${baseline.yCount})\n`,
    )
    return 0
  }

  // Default / --json: emit the scored payload.
  if (flag('--json')) {
    const out = opt('--json', null)
    const text = JSON.stringify(result, null, 2) + '\n'
    if (out) {
      mkdirSync(dirname(resolve(CWD, out)), { recursive: true })
      writeFileSync(resolve(CWD, out), text, 'utf-8')
      process.stdout.write(`gold-audit: wrote ${out}\n`)
    } else {
      process.stdout.write(text)
    }
    return 0
  }

  process.stdout.write(
    `gold-audit: score ${result.score} · Y ${result.yCount}/${result.totals.checks} · ` +
      `RISKY ${result.riskyCount} (N ${result.totals.n}, P ${result.totals.p}, NA ${result.totals.na}, NV ${result.totals.nv})\n`,
  )
  return 0
}

try {
  process.exit(main())
} catch (err) {
  // Fail-closed: an unexpected crash is a hard gate failure, never a silent pass.
  process.stderr.write(`gold-audit: unexpected error — ${err?.message ?? err}\n`)
  process.exit(1)
}
