#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// CATALOG: T4 (gold-doc-tranches-t3-t5.md §2, gold-doc-capability H4) — per-doc freshness gate.
// CATALOG: check-doc-style.mjs validates last_review's ISO *format*; 09-heartbeat.yml's
// CATALOG: assert-monthly-freshness job asserts the monthly CI LANE itself is recent (liveness, a
// CATALOG: different axis — the stamp-file predecessor of that job was retired in #2520 as
// CATALOG: vacuous). This gate is the ONE that asks "is the doc actually current?" — it never
// CATALOG: existed before.
//
// arbiter — gold doc-set freshness audit. Deterministic, binary, fail-closed. Grades every
// applicable required check's PRESENT file(s) (mandatory + recommended — the same requirement
// bands check-doc-set.mjs resolves, via the shared scripts/lib/doc-set-resolve.mjs) against:
//   1. Clock = frontmatter `last_review`. Missing/empty/unparseable ⇒ STALE (fail-closed, INV-96).
//   2. Per-class max-age bar, from the manifest's `freshness_class` (defaults below; a manifest
//      `freshness_bars:` map may override per repo).
//   3. Change-coupling (strongest signal): a `couples_to:` glob list on the check — if the code it
//      describes changed more recently than `last_review` (day-granular), STALE regardless of bar.
//   4. Exemptions: non-.md targets, `status: deprecated|archived` tombstones, `decision`-class
//      docs (immutable once accepted — never re-dated).
//
// There is NO advisory/soft mode inside this script (INV-96/INV-53): the verdict is binary.
// Softness (advisory vs monthly-gate vs release-blocking) lives entirely in the WIRING lane
// (_monthly.yml / 05-release.yml, per pipelineStyle) — this script never encodes it.
//
// Usage:
//   node scripts/check-doc-freshness.mjs [--json] [--manifest P] [--profile P] [--help]
//     --json          emit the audit as JSON (per-doc detail)
//     --manifest      manifest path (default standards/gold-doc-set.yml)
//     --profile       overlay profile path (default standards/doc-profile)
//     --help, -h      show this help
//
// Exit codes (INV-53): 0 = all graded docs fresh (or SKIP: no manifest) | 1 = >=1 stale doc |
// 2 = IO/config error (unparseable manifest/profile, or a fail-closed profile validation error).

import { existsSync, readFileSync } from 'node:fs'
import { resolve, basename } from 'node:path'
import { spawnSync } from 'node:child_process'
import { parse as parseYaml } from 'yaml'
import {
  loadOverlays,
  loadTierColumn,
  requirementFor,
  resolveEffectiveColumn,
  resolvePresentPaths,
} from './lib/doc-set-resolve.mjs'
// SKIP_FILENAMES (INDEX.md, DECISIONS.md, ...): auto-generated digests that check-doc-style.mjs
// already exempts from carrying frontmatter at all — a generated file has no `last_review` to
// grade honestly (the next regen wouldn't preserve one anyway), so this gate defers to the SAME
// convention rather than inventing a second "no frontmatter expected" allowlist.
import { SKIP_FILENAMES } from './check-doc-style.mjs'

const args = process.argv.slice(2)
if (args.includes('--help') || args.includes('-h')) {
  process.stdout.write(
    [
      'Usage: node scripts/check-doc-freshness.mjs [options]',
      '',
      'Deterministic per-doc freshness audit (standards/gold-doc-set.yml). Binary: fresh (0) or',
      'stale (1) — no advisory mode; softness lives in the wiring lane, not this script.',
      '',
      '  --json          emit JSON (per-doc detail)',
      '  --manifest P    manifest path (default standards/gold-doc-set.yml)',
      '  --profile P     overlay profile path (default standards/doc-profile)',
      '  --help, -h      show this help',
      '',
    ].join('\n'),
  )
  process.exit(0)
}

const opt = (name, def) => {
  const i = args.indexOf(name)
  return i >= 0 && args[i + 1] ? args[i + 1] : def
}
const flag = (name) => args.includes(name)
const CWD = process.cwd()
const MANIFEST = opt('--manifest', 'standards/gold-doc-set.yml')
const PROFILE = opt('--profile', 'standards/doc-profile')

// §2.2 table: per-`freshness_class` max-age bar (days). `decision` is handled as an exemption
// (age-exempt, immutable-once-accepted), never consulted here. A row with NO `freshness_class`
// (most conditional families predate the field) defaults to the `policy` bar — the safest
// generic assumption until each family is backfilled with an explicit class.
const DEFAULT_BARS = { 'high-churn': 90, operational: 90, policy: 180, regulatory: 365 }
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

/** Minimal frontmatter key extractor (last_review/status only) — mirrors check-doc-style.mjs's
 *  parseFrontmatter shape without importing it (this script stays self-contained, same pattern
 *  every other check-*.mjs gate in this repo follows). */
function parseFrontmatterKeys(content) {
  const lines = content.split('\n')
  if (lines[0] !== '---') return new Map()
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] !== '---') continue
    const kv = new Map()
    for (const ln of lines.slice(1, i)) {
      const m = ln.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.*)$/)
      if (m) kv.set(m[1], m[2].replace(/^['"]|['"]$/g, '').trim())
    }
    return kv
  }
  return new Map()
}

function git(cwdArgs, cwd) {
  const r = spawnSync('git', cwdArgs, { cwd, encoding: 'utf-8' })
  return r.status === 0 ? r.stdout.trim() : null
}

function isGitAvailable(cwd) {
  return git(['rev-parse', '--is-inside-work-tree'], cwd) === 'true'
}

function isShallowClone(cwd) {
  // A depth-1 checkout's `git log -- path` lies (may report no history at all for a path that
  // has plenty) — treat exactly like "not a git repo" (coupling signal skipped, age bar still
  // enforced). Per the CI wiring note: the freshness job MUST checkout with fetch-depth: 0.
  return git(['rev-parse', '--is-shallow-repository'], cwd) === 'true'
}

/** `git log -1 --format=%cI -- <globs>` — the last commit that touched any coupled path. */
function lastCoupledCommitDay(globs, cwd) {
  const out = git(['log', '-1', '--format=%cI', '--', ...globs], cwd)
  return out ? out.slice(0, 10) : null
}

/** fresh | stale | skipped — never consulted for a doc without `couples_to`. */
function evaluateCoupling(check, lastReview, cwd) {
  if (!check.couples_to?.length) return 'skipped'
  if (!isGitAvailable(cwd) || isShallowClone(cwd)) return 'skipped'
  const commitDay = lastCoupledCommitDay(check.couples_to, cwd)
  if (!commitDay) return 'skipped' // no commit has ever touched the coupled globs
  return commitDay > lastReview ? 'stale' : 'fresh' // day-granular; same-day passes
}

/**
 * Grade ONE resolved present file for ONE check. Returns `{ exempt: true, ... }` for a doc this
 * gate deliberately never stales (non-.md target, tombstone, decision record).
 */
function evaluateDoc(check, filePath, bars, cwd) {
  const base = { path: filePath, class: check.freshness_class ?? null }
  if (!filePath.endsWith('.md')) return { ...base, exempt: 'non-md', verdict: 'fresh' }
  if (SKIP_FILENAMES.has(basename(filePath))) {
    return { ...base, exempt: 'generated-no-frontmatter', verdict: 'fresh' }
  }
  // changesets' prependFile uses the first line as its insertion anchor; top-of-file frontmatter
  // would be spliced into by every future release, corrupting the metadata block.
  if (basename(filePath) === 'CHANGELOG.md') {
    return { ...base, exempt: 'changesets-managed', verdict: 'fresh' }
  }

  const abs = resolve(cwd, filePath)
  const content = readFileSync(abs, 'utf-8')
  const kv = parseFrontmatterKeys(content)
  const status = kv.get('status')
  if (status === 'deprecated' || status === 'archived') {
    return { ...base, exempt: 'tombstone', verdict: 'fresh' }
  }
  if (check.freshness_class === 'decision') {
    return { ...base, exempt: 'decision-immutable', verdict: 'fresh' }
  }

  const raw = kv.get('last_review')
  const lastReview = raw && ISO_DATE.test(raw) ? raw : null
  if (!lastReview) {
    // Fail-closed (INV-96): missing/empty/unparseable last_review on a required doc is STALE,
    // never a vacuous pass.
    return {
      ...base,
      last_review: raw || null,
      verdict: 'stale',
      reason: 'missing or unparseable last_review',
    }
  }

  const ageDays = Math.floor((Date.now() - Date.parse(lastReview)) / 86_400_000)
  const bar = bars[check.freshness_class] ?? bars.policy
  const coupling = evaluateCoupling(check, lastReview, cwd)
  const verdict = ageDays > bar || coupling === 'stale' ? 'stale' : 'fresh'

  return { ...base, last_review: lastReview, age_days: ageDays, bar, coupling, verdict }
}

function main() {
  if (!existsSync(resolve(CWD, MANIFEST))) {
    process.stdout.write(`check-doc-freshness: SKIP — no manifest at ${MANIFEST}\n`)
    return 0
  }
  let manifest
  try {
    manifest = parseYaml(readFileSync(resolve(CWD, MANIFEST), 'utf-8'))
  } catch (err) {
    process.stderr.write(`check-doc-freshness: unreadable manifest ${MANIFEST} — ${err.message}\n`)
    return 2
  }
  // T1b: apply the SAME tier_floor max()-semantics presence uses (scripts/check-doc-set.mjs) —
  // freshness and presence must never disagree about which column a repo is graded on.
  const { overlays, tierFloor } = loadOverlays(CWD, PROFILE)
  const tierColumn = resolveEffectiveColumn(loadTierColumn(CWD), tierFloor)
  const bars = { ...DEFAULT_BARS, ...(manifest.freshness_bars || {}) }

  const docs = []
  for (const check of manifest.checks || []) {
    const applicable = check.applies === 'always' || overlays.has(check.applies)
    if (!applicable) continue
    const requirement = requirementFor(check, tierColumn)
    if (requirement === 'skip') continue

    for (const filePath of resolvePresentPaths(check, CWD)) {
      docs.push(evaluateDoc(check, filePath, bars, CWD))
    }
  }

  const stale = docs.filter((d) => d.verdict === 'stale')

  if (flag('--json')) {
    process.stdout.write(JSON.stringify({ manifest: MANIFEST, tierColumn, docs }, null, 2) + '\n')
  } else {
    process.stdout.write(
      `check-doc-freshness [tier: ${tierColumn}]: ${docs.length - stale.length}/${docs.length} graded docs fresh\n`,
    )
    for (const d of stale) {
      const detail = d.reason ?? `age=${d.age_days}d bar=${d.bar}d coupling=${d.coupling}`
      process.stdout.write(`    STALE ${d.path} (${detail})\n`)
    }
  }

  return stale.length > 0 ? 1 : 0
}

try {
  process.exit(main())
} catch (err) {
  process.stderr.write(`check-doc-freshness: unexpected error — ${err?.message ?? err}\n`)
  process.exit(2)
}
