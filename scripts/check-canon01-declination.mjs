#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// CATALOG: CANON-01 machine check (#1922, ACTION_PLAN.md B2) — dual-sided declination.
// CATALOG: Enumerates arbiter's OWN governance mechanisms (hooks registered in
// CATALOG: .claude/settings.json + every runCheck/runWarnCheck/runToolCheck script in
// CATALOG: scripts/check-all.mjs) and maps each to exactly one of: a template emission
// CATALOG: under src/templates/**, a motivated .dogfood-divergences.json entry, or a
// CATALOG: reasoned entry in scripts/canon01-self-only.json. Unmapped = FAIL, named.
// CATALOG: Plus a monotone ratchet: neither the divergence ledger nor the self-only
// CATALOG: allowlist may grow (scripts/canon01-baseline.json).
// CATALOG: Rejected fold-in into check-self-dogfood.mjs (INV-45/CANON-14): that gate walks
// CATALOG: the TEMPLATE corpus forward (template -> materialized byte-drift, pinned diff
// CATALOG: hashes). It cannot see a self-only mechanism, because a mechanism with no
// CATALOG: template is invisible to a template walk. This gate is the REVERSE enumeration
// CATALOG: (mechanism -> template) and owns the count ratchet the forward gate has no
// CATALOG: baseline for. Merging them would fuse two opposite traversal directions and two
// CATALOG: unrelated failure models into one script.
// CATALOG: Rejected fold-in into check-inv-enforcement-wired.mjs (INV-52/CANON-09): that
// CATALOG: gate asserts every enforcement script CITED IN THE CATALOG is wired in
// CATALOG: check-all.mjs (citation -> wiring). It says nothing about whether a wired
// CATALOG: mechanism is also emitted to targets — the opposite axis.
//
// Dual-track (Track A self / Track B emitted): NOT APPLICABLE. This gate audits arbiter's
// own generator-vs-settings symmetry; a consumer project does not generate governance for
// anyone, so a .ejs twin would be a gate with no subject. It is therefore itself a
// self-only mechanism and carries its own entry in scripts/canon01-self-only.json.
//
// Buckets:
//   template      — a file named <basename>[.ejs] exists under src/templates/** (hooks are
//                   additionally required to live under src/templates/claude/hooks/).
//   divergence    — the basename is pinned in .dogfood-divergences.json (a template twin
//                   that intentionally differs; the diff itself is policed by
//                   check-self-dogfood.mjs, not here).
//   self-only     — scripts/canon01-self-only.json entry. `reason` is MANDATORY (an entry
//                   without one is a blanket allowlist, so it FAILs). `expires` marks a
//                   STAGED entry — not yet confirmed self-only, audit due by that date;
//                   an expired entry FAILs, mirroring check-self-dogfood's doctrine that
//                   audit-mode is a stage with a deadline, not a destination. An undated
//                   entry is permanent-by-design: arbiter is the generator, and the
//                   mechanism's subject is arbiter's own generator corpus.
//   external-tool — a check-all invocation of an off-the-shelf binary (npx/npm/gitleaks/
//                   actionlint...). Arbiter did not author it, so it has no template twin
//                   by construction; tool-vs-CI-vs-manifest parity is owned by
//                   scripts/check-ci-tool-parity.mjs. Counted and printed, never silently
//                   dropped (INV-96).
//
// Cross-list contradiction: a self-only path that also appears in TRACK_B_EXEMPT
// (check-inv-enforcement-wired.mjs) or in scripts/optional-emissions.json is a flat
// contradiction — those lists mean "emitted to targets, not run by self", this one means
// "run by self, not emitted" — and FAILs.
//
// --update-baseline recomputes and writes ONLY when every observed count is <= the stored
// one. There is deliberately no --allow-increase: an increase is exactly the event the
// ratchet exists to catch, and a flag that logs loudly is still a flag that passes. Growth
// is legitimised the only honest way — by hand-editing scripts/canon01-baseline.json in the
// same PR as the new entry. That is deliberately MORE ceremony than a flag, not less: the
// raised number lands in the reviewable diff next to the `expires`-dated entry and the reason
// that justifies it, where a --allow-increase flag would leave only a log line nobody reads.
//
// Known ceiling (declared, not implemented): a hook whose template file exists but which
// settings.json.ejs does not wire (the self-first activation state documented in the
// CLAUDE.md divergence entry) counts as `template` here. Detecting that third state means
// rendering settings.json.ejs, which is check-self-dogfood.mjs's job.
//
// Exit codes (INV-53): 0 PASS, 1 FAIL (unmapped / bad entry / ratchet growth), 2 invocation
// or IO error (a required input missing is an ERROR, never a pass).
//
// Usage:
//   node scripts/check-canon01-declination.mjs [--root=dir] [--settings=path] [--gate=path]
//     [--templates=dir] [--divergences=path] [--self-only=path] [--baseline=path]
//     [--now=YYYY-MM-DD] [--update-baseline]
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { walkRepo } from './lib/glob-walk.mjs'
import { enumerateGateMechanisms } from './lib/gate-roster.mjs'

const LABEL = '[check-canon01-declination]'

function parseArgs(argv) {
  // `--name=value` only. `name.length + 3` skips the leading `--` and the `=`.
  const get = (name) => argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3)
  const root = resolve(get('root') ?? join(dirname(fileURLToPath(import.meta.url)), '..'))
  const at = (name, fallback) => resolve(root, get(name) ?? fallback)
  return {
    root,
    settingsPath: at('settings', '.claude/settings.json'),
    gatePath: at('gate', 'scripts/check-all.mjs'),
    templatesDir: at('templates', 'src/templates'),
    divergencesPath: at('divergences', '.dogfood-divergences.json'),
    selfOnlyPath: at('self-only', 'scripts/canon01-self-only.json'),
    baselinePath: at('baseline', 'scripts/canon01-baseline.json'),
    now: get('now') ? new Date(`${get('now')}T00:00:00Z`) : new Date(),
    updateBaseline: argv.includes('--update-baseline'),
  }
}

/** Read a required JSON input. A missing or malformed input is an ERROR (exit 2). */
function readJson(path, what) {
  if (!existsSync(path)) {
    throw Object.assign(new Error(`missing required ${what}: ${path}`), { exitCode: 2 })
  }
  try {
    return JSON.parse(readFileSync(path, 'utf-8'))
  } catch (err) {
    throw Object.assign(new Error(`malformed ${what} (${path}): ${err.message}`), { exitCode: 2 })
  }
}

/**
 * Every hook script registered in .claude/settings.json, in declaration order.
 * Reads the raw text rather than the parsed shape so a hook stays visible even if
 * the event/matcher nesting changes (fail-closed against a settings refactor).
 */
export function enumerateHooks(settingsSrc) {
  const hooks = []
  for (const m of settingsSrc.matchAll(/\.claude\/hooks\/([\w.-]+\.mjs)/g)) {
    const path = `.claude/hooks/${m[1]}`
    if (!hooks.includes(path)) hooks.push(path)
  }
  return hooks
}

/** Basenames emitted by the template corpus, plus the subset under claude/hooks/. */
function indexTemplates(root, templatesDir) {
  const all = new Set()
  const hooks = new Set()
  if (!existsSync(templatesDir)) {
    throw Object.assign(new Error(`missing template corpus: ${templatesDir}`), { exitCode: 2 })
  }
  const rel = templatesDir.slice(root.length + 1)
  for (const file of walkRepo(root)) {
    if (!file.startsWith(`${rel}/`)) continue
    const base = file
      .split('/')
      .pop()
      .replace(/\.ejs$/, '')
    all.add(base)
    if (file.startsWith(`${rel}/claude/hooks/`)) hooks.add(base)
  }
  return { all, hooks }
}

/** One self-only entry's validity. Returns a problem string, or null when the entry is sound. */
function selfOnlyEntryProblem(entry, now) {
  if (!entry || typeof entry.path !== 'string' || entry.path === '') {
    return 'self-only entry without a `path`'
  }
  if (typeof entry.reason !== 'string' || entry.reason.trim() === '') {
    return `${entry.path}: self-only entry has no \`reason\` — a reasonless entry is a blanket allowlist`
  }
  if (entry.expires == null) return null
  const due = new Date(`${entry.expires}T00:00:00Z`)
  if (Number.isNaN(due.getTime())) {
    return `${entry.path}: unparseable \`expires\` (${entry.expires})`
  }
  if (due.getTime() < now.getTime()) {
    return `${entry.path}: EXPIRED staged self-only entry (due ${entry.expires}) — confirm it is self-only by construction and drop the date, or emit the template twin`
  }
  return null
}

/**
 * Validate the self-only allowlist and index it by path. `reason` is mandatory; an
 * `expires` date in the past is a violation. Returns { byPath, problems }.
 */
export function indexSelfOnly(entries, now) {
  if (!Array.isArray(entries)) {
    throw Object.assign(new Error('self-only allowlist: `selfOnly` must be an array'), {
      exitCode: 2,
    })
  }
  const byPath = new Map()
  const problems = []
  for (const entry of entries) {
    const problem = selfOnlyEntryProblem(entry, now)
    if (problem) problems.push(problem)
    else byPath.set(entry.path, entry)
  }
  return { byPath, problems }
}

/** Names on the "emitted to targets, not self-run" lists — the opposite claim to self-only. */
function readEmittedOnlyNames(root) {
  const names = new Set()
  const wiredPath = join(root, 'scripts/check-inv-enforcement-wired.mjs')
  if (existsSync(wiredPath)) {
    const block = readFileSync(wiredPath, 'utf-8').match(
      /TRACK_B_EXEMPT\s*=\s*new Set\(\[([\s\S]*?)\]\)/,
    )
    if (block) for (const m of block[1].matchAll(/'([\w.-]+\.mjs)'/g)) names.add(m[1])
  }
  const optionalPath = join(root, 'scripts/optional-emissions.json')
  if (existsSync(optionalPath)) {
    try {
      for (const e of JSON.parse(readFileSync(optionalPath, 'utf-8')).optional ?? [])
        if (typeof e.path === 'string') names.add(e.path.split('/').pop())
    } catch {
      throw Object.assign(new Error('malformed scripts/optional-emissions.json'), { exitCode: 2 })
    }
  }
  return names
}

function classify(mechPath, isHook, ctx) {
  const base = mechPath.split('/').pop()
  const emitted = isHook ? ctx.templates.hooks : ctx.templates.all
  if (emitted.has(base)) return 'template'
  if (ctx.divergenceBasenames.has(base)) return 'divergence'
  if (ctx.selfOnly.has(mechPath)) {
    ctx.usedSelfOnly.add(mechPath)
    return 'self-only'
  }
  return null
}

/** Read a required text input. Absent = ERROR (exit 2), never a pass. */
function readRequired(path, what) {
  if (!existsSync(path)) {
    throw Object.assign(new Error(`missing required ${what}: ${path}`), { exitCode: 2 })
  }
  return readFileSync(path, 'utf-8')
}

function loadInputs(opts) {
  const divergences = readJson(opts.divergencesPath, 'divergence ledger')
  if (!Array.isArray(divergences)) {
    throw Object.assign(new Error('divergence ledger must be an array'), { exitCode: 2 })
  }
  return {
    settingsSrc: readRequired(opts.settingsPath, 'settings'),
    gateSrc: readRequired(opts.gatePath, 'gate'),
    divergences,
    selfOnlyDoc: readJson(opts.selfOnlyPath, 'self-only allowlist'),
    baseline: readJson(opts.baselinePath, 'ratchet baseline'),
  }
}

/** Bucket every self mechanism. Returns { counts, unmapped }. */
function buildInventory(ctx, gateSrc, settingsSrc) {
  const counts = { template: 0, divergence: 0, 'self-only': 0, 'external-tool': 0 }
  const unmapped = []
  const seen = new Set()
  for (const mech of enumerateGateMechanisms(gateSrc)) {
    if (mech.path === null) {
      counts['external-tool']++
      continue
    }
    if (seen.has(mech.path)) continue
    seen.add(mech.path)
    const bucket = classify(mech.path, false, ctx)
    if (bucket) counts[bucket]++
    else unmapped.push(`${mech.path} (check-all: '${mech.name}')`)
  }
  for (const hook of enumerateHooks(settingsSrc)) {
    const bucket = classify(hook, true, ctx)
    if (bucket) counts[bucket]++
    else unmapped.push(`${hook} (settings.json hook)`)
  }
  return { counts, unmapped }
}

/**
 * Dead entry: a self-only path nothing maps to — it inflates the ratchet forever and exempts
 * nothing (check-self-dogfood's stale-entry doctrine). Contradiction: a path another list
 * claims is emitted-to-targets.
 */
function auditSelfOnlyList(ctx, root) {
  const emittedOnly = readEmittedOnlyNames(root)
  const problems = []
  for (const path of ctx.selfOnly.keys()) {
    if (!ctx.usedSelfOnly.has(path)) {
      problems.push(
        `${path}: DEAD self-only entry — no registered hook or check-all mechanism resolves to it; remove it and lower the baseline`,
      )
    }
    if (emittedOnly.has(path.split('/').pop())) {
      problems.push(
        `${path}: claimed self-only here but listed as emitted-to-targets in TRACK_B_EXEMPT / optional-emissions.json — the two claims are contradictory`,
      )
    }
  }
  return problems
}

function applyBaselineUpdate(opts, baseline, observed, grown) {
  if (grown.length > 0) {
    for (const k of grown) {
      process.stdout.write(
        `  RATCHET refused: ${k} ${observed[k]} > baseline ${baseline[k] ?? 0} — --update-baseline only lowers. Add an \`expires\`-dated entry with a reason and raise the baseline by hand in the same PR.\n`,
      )
    }
    process.stdout.write(`${LABEL} FAIL: refusing to raise the baseline\n`)
    return 1
  }
  writeFileSync(
    opts.baselinePath,
    `${JSON.stringify({ ...baseline, ...observed, capturedAt: new Date().toISOString() }, null, 2)}\n`,
  )
  process.stdout.write(
    `${LABEL} baseline lowered: divergences=${observed.divergences} selfOnly=${observed.selfOnly}\n`,
  )
  return 0
}

function report({ counts, unmapped, problems, grown, observed, baseline }) {
  for (const line of unmapped) process.stdout.write(`  UNMAPPED mechanism: ${line}\n`)
  for (const line of problems) process.stdout.write(`  ${line}\n`)
  for (const k of grown) {
    process.stdout.write(
      `  RATCHET: ${k} grew to ${observed[k]} (baseline ${baseline[k] ?? 0}) — CANON-01 divergence is monotone-decreasing\n`,
    )
  }

  const total = counts.template + counts.divergence + counts['self-only'] + unmapped.length
  const summary = `${total} self mechanisms (${counts.template} template, ${counts.divergence} divergence, ${counts['self-only']} self-only, ${unmapped.length} unmapped) + ${counts['external-tool']} external-tool invocations (parity owned by check-ci-tool-parity.mjs)`

  if (unmapped.length + problems.length + grown.length > 0) {
    process.stdout.write(`${LABEL} FAIL — ${summary}\n`)
    return 1
  }
  process.stdout.write(
    `${LABEL} OK — ${summary}; ratchet divergences=${observed.divergences}/${baseline.divergences} selfOnly=${observed.selfOnly}/${baseline.selfOnly}\n`,
  )
  return 0
}

function main() {
  const opts = parseArgs(process.argv.slice(2))
  const { settingsSrc, gateSrc, divergences, selfOnlyDoc, baseline } = loadInputs(opts)
  const { byPath: selfOnly, problems } = indexSelfOnly(selfOnlyDoc.selfOnly, opts.now)

  const ctx = {
    templates: indexTemplates(opts.root, opts.templatesDir),
    divergenceBasenames: new Set(divergences.map((d) => String(d.path).split('/').pop())),
    selfOnly,
    usedSelfOnly: new Set(),
  }
  const { counts, unmapped } = buildInventory(ctx, gateSrc, settingsSrc)
  problems.push(...auditSelfOnlyList(ctx, opts.root))

  const observed = { divergences: divergences.length, selfOnly: selfOnly.size }
  const grown = Object.keys(observed).filter((k) => observed[k] > (baseline[k] ?? 0))

  return opts.updateBaseline
    ? applyBaselineUpdate(opts, baseline, observed, grown)
    : report({ counts, unmapped, problems, grown, observed, baseline })
}

try {
  process.exit(main())
} catch (err) {
  // Fail-closed (INV-96): never let an unexpected error read as a pass.
  process.stderr.write(`${LABEL} ${err instanceof Error ? err.message : String(err)}\n`)
  process.exit(err?.exitCode === 2 ? 2 : 1)
}
