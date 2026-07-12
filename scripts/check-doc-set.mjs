#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// CATALOG: P8 doc-governance gate — deterministic presence audit of the canonical doc-set
// CATALOG: (standards/gold-doc-set.yml) with overlay + accept_any matching and --generate
// CATALOG: stub scaffolding. Not folded into check-doc-style.mjs (per-file frontmatter) nor
// CATALOG: gen-doc-index.mjs (index build): this grades the doc SET against the manifest.
// arbiter — gold doc-set audit (#1374). Deterministic presence audit of the canonical
// documentation set declared in standards/gold-doc-set.yml. The verdict is computed by
// code, never by an AI: same repo + same manifest ⇒ identical output.
//
// Tiers: mandatory (gap = strict failure) | recommended (gap = warning) | conditional
// (only applies when its overlay is enabled in standards/doc-profile). `accept_any` lists
// equivalent paths (architecture=blueprint, coding-standards=naming-convention, ...); a
// check passes if ANY candidate exists. `glob` passes if >=1 file matches.
//
// Exit codes (INV contract): 0 = pass/advisory, 1 = failure/error.
//
// Usage:
//   node scripts/check-doc-set.mjs [--strict] [--json] [--generate] [--refresh-stubs]
//     [--manifest P] [--profile P] [--help]
//     --strict        exit 1 if any mandatory doc is missing (default: advisory, exit 0)
//     --json          emit the audit as JSON
//     --generate      scaffold stub files for missing mandatory+recommended .md docs
//     --refresh-stubs (with --generate) re-render a doc IN PLACE only if it is byte-equal to the
//                     freshly rendered stub — a real, hand-written doc is NEVER overwritten
//     --manifest      manifest path (default standards/gold-doc-set.yml)
//     --profile       overlay profile path (default standards/doc-profile)
//
// Write-safety (#1415): --generate writes a stub ONLY when the target file is MISSING (the
// `!existsSync` guard) — it never overwrites any existing file. Stub-refresh-in-place is opt-in
// via --refresh-stubs and overwrites ONLY a file whose bytes equal the rendered stub template.

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { parse as parseYaml } from 'yaml'
import {
  isPresent,
  loadOverlays,
  loadTierColumn,
  requirementFor,
  resolveEffectiveColumn,
} from './lib/doc-set-resolve.mjs'

const args = process.argv.slice(2)
if (args.includes('--help') || args.includes('-h')) {
  process.stdout.write(
    [
      'Usage: node scripts/check-doc-set.mjs [options]',
      '',
      'Deterministic presence audit of the canonical doc-set (standards/gold-doc-set.yml).',
      '',
      '  --strict        exit 1 if any mandatory doc is missing (default: advisory)',
      '  --json          emit JSON',
      '  --generate      scaffold stubs for missing mandatory+recommended .md docs',
      '  --refresh-stubs (with --generate) re-render a doc in place only if it is byte-equal',
      '                  to the stub template (never overwrites a real, hand-written doc)',
      '  --manifest P    manifest path (default standards/gold-doc-set.yml)',
      '  --profile P     overlay profile path (default standards/doc-profile)',
      '  --help, -h      show this help',
      '',
    ].join('\n'),
  )
  process.exit(0)
}

const flag = (name) => args.includes(name)
const opt = (name, def) => {
  const i = args.indexOf(name)
  return i >= 0 && args[i + 1] ? args[i + 1] : def
}
const CWD = process.cwd()
const MANIFEST = opt('--manifest', 'standards/gold-doc-set.yml')
const PROFILE = opt('--profile', 'standards/doc-profile')

function stubFor(check) {
  const isDocsMd = check.path.startsWith('docs/') && check.path.endsWith('.md')
  const title = check.path.split('/').pop().replace(/\.md$/, '')
  const banner =
    `> **STUB — fill me in.** Scaffolded by \`check-doc-set --generate\` to satisfy the gold doc-set. ${check.purpose || ''}`.trim()
  if (isDocsMd) {
    const today = new Date().toISOString().slice(0, 10)
    return [
      '---',
      `title: '${title}'`,
      "doc_version: '0.1.0'",
      'status: draft',
      `last_review: '${today}'`,
      "owner: ''",
      "canonical_id: ''",
      "tags: ['audience/dev', 'kind/reference']",
      'related: []',
      '---',
      '',
      `# ${title}`,
      '',
      banner,
      '',
    ].join('\n')
  }
  return `# ${title}\n\n${banner}\n`
}

function main() {
  if (!existsSync(resolve(CWD, MANIFEST))) {
    process.stdout.write(`check-doc-set: SKIP — no manifest at ${MANIFEST}\n`)
    return 0
  }
  const manifest = parseYaml(readFileSync(resolve(CWD, MANIFEST), 'utf-8'))
  const { overlays, tierFloor } = loadOverlays(CWD, PROFILE)
  const tierDerived = loadTierColumn(CWD)
  // T1b (gold-doc-self-tier-and-coherence.md §1): tierColumn is the EFFECTIVE column used for
  // every resolution below; tierDerived is what collaborationMode alone would have produced —
  // both are reported so every audit is self-explanatory about whether a floor is in play.
  const tierColumn = resolveEffectiveColumn(tierDerived, tierFloor)

  const present = []
  const missingMandatory = []
  const missingRecommended = []
  const na = []
  const generated = []
  const refreshed = []
  // T3 (gold-doc-tranches-t3-t5.md §1.2a): structured missing[] entries, additive alongside the
  // existing missingMandatory/missingRecommended string arrays (the doc-set.test.ts payload-
  // parity test keeps passing — same shape emitted for the CLI wrapper and the raw script since
  // both invoke this exact function). Consumed by src/generators/doc-set.ts to resolve which
  // skeleton template (if any, via the dormant `template:` field) satisfies a gap.
  const missing = []

  // --refresh-stubs (opt-in) re-renders an EXISTING doc in place, but ONLY when its bytes equal
  // the freshly rendered stub — a real, hand-written doc is never touched. It runs for present
  // docs too (a scaffolded stub passes the presence check), so handle it before the missing path.
  const doRefresh = flag('--generate') && flag('--refresh-stubs')
  if (doRefresh) {
    for (const check of manifest.checks || []) {
      const applicable = check.applies === 'always' || overlays.has(check.applies)
      if (!applicable || !check.path.endsWith('.md')) continue
      const abs = resolve(CWD, check.path)
      if (!existsSync(abs)) continue
      const current = readFileSync(abs, 'utf-8')
      const stub = stubFor(check)
      if (current === stub) {
        writeFileSync(abs, stub) // idempotent rewrite of a byte-equal stub
        refreshed.push(check.path)
      }
    }
  }

  for (const check of manifest.checks || []) {
    const applicable = check.applies === 'always' || overlays.has(check.applies)
    if (!applicable) {
      na.push(check)
      continue
    }
    // H3: tiers{} (when present) resolves the requirement band for THIS repo's
    // collaborationMode column — 'skip' (o|-) is dormant, same bucket as inapplicable.
    const requirement = requirementFor(check, tierColumn)
    if (requirement === 'skip') {
      na.push(check)
      continue
    }
    if (isPresent(check, CWD)) {
      present.push(check)
      continue
    }
    if (requirement === 'mandatory') missingMandatory.push(check)
    else missingRecommended.push(check)
    missing.push({
      path: check.path,
      requirement,
      template: check.template,
      freshness_class: check.freshness_class,
      purpose: check.purpose,
    })

    if (flag('--generate') && check.path.endsWith('.md')) {
      const abs = resolve(CWD, check.path)
      mkdirSync(dirname(abs), { recursive: true })
      // Primary write-safety guard: only scaffold when the file is MISSING (never overwrite).
      if (!existsSync(abs)) {
        writeFileSync(abs, stubFor(check))
        generated.push(check.path)
      }
    }
  }

  const applicable = present.length + missingMandatory.length + missingRecommended.length
  const report = {
    manifest: MANIFEST,
    profile: { overlays: [...overlays] },
    tierColumn, // H3/T1b: the EFFECTIVE tiers{} column ('solo'|'small'|'enterprise') this run used
    tierDerived, // T1b: what collaborationMode alone resolves to, before any tier_floor
    tierFloor: tierFloor ?? null, // T1b: the profile's tier_floor, or null when unset
    totals: {
      applicable,
      present: present.length,
      missingMandatory: missingMandatory.length,
      missingRecommended: missingRecommended.length,
      na: na.length,
    },
    missingMandatory: missingMandatory.map((c) => c.path),
    missingRecommended: missingRecommended.map((c) => c.path),
    missing,
    // T3 (gold-doc-tranches-t3-t5.md §1.2c banner-upgrade): a check whose file EXISTS is
    // "present" regardless of content — a banner stub scaffolded by a prior --generate/--apply
    // run passes presence too, so it is otherwise invisible to a missing[]-only consumer. Mirrors
    // `missing[]`'s shape (minus `requirement`, irrelevant once present) so the generator can
    // detect + upgrade an untouched stub without a second resolution pass.
    present: present.map((c) => ({
      path: c.path,
      template: c.template,
      freshness_class: c.freshness_class,
      purpose: c.purpose,
    })),
    generated,
    refreshed,
  }

  if (flag('--json')) {
    process.stdout.write(JSON.stringify(report, null, 2) + '\n')
  } else {
    process.stdout.write(
      `check-doc-set [tier: ${tierColumn}]: ${present.length}/${applicable} applicable docs present ` +
        `(mandatory gaps: ${missingMandatory.length}, recommended gaps: ${missingRecommended.length}, n/a: ${na.length})\n`,
    )
    for (const c of missingMandatory) process.stdout.write(`    MISSING [mandatory] ${c.path}\n`)
    for (const c of missingRecommended)
      process.stdout.write(`    missing [recommended] ${c.path}\n`)
    for (const p of generated) process.stdout.write(`    + scaffolded stub: ${p}\n`)
    for (const p of refreshed) process.stdout.write(`    ~ refreshed stub: ${p}\n`)
  }

  if (flag('--strict') && missingMandatory.length > 0) return 1
  return 0
}

try {
  process.exit(main())
} catch (err) {
  process.stderr.write(`check-doc-set: unexpected error — ${err?.message ?? err}\n`)
  process.exit(1)
}
