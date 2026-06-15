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
//   node scripts/check-doc-set.mjs [--strict] [--json] [--generate] [--manifest P] [--profile P] [--help]
//     --strict     exit 1 if any mandatory doc is missing (default: advisory, exit 0)
//     --json       emit the audit as JSON
//     --generate   scaffold stub files for missing mandatory+recommended .md docs
//     --manifest   manifest path (default standards/gold-doc-set.yml)
//     --profile    overlay profile path (default standards/doc-profile)

import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { parse as parseYaml } from 'yaml'

const args = process.argv.slice(2)
if (args.includes('--help') || args.includes('-h')) {
  process.stdout.write(
    [
      'Usage: node scripts/check-doc-set.mjs [options]',
      '',
      'Deterministic presence audit of the canonical doc-set (standards/gold-doc-set.yml).',
      '',
      '  --strict      exit 1 if any mandatory doc is missing (default: advisory)',
      '  --json        emit JSON',
      '  --generate    scaffold stubs for missing mandatory+recommended .md docs',
      '  --manifest P  manifest path (default standards/gold-doc-set.yml)',
      '  --profile P   overlay profile path (default standards/doc-profile)',
      '  --help, -h    show this help',
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

const isGlob = (p) => /[*?\[\]]/.test(p)

/** True if at least one file under the glob's directory matches its pattern. */
function globMatches(pattern) {
  const dir = dirname(pattern)
  const base = pattern.slice(dir.length + 1)
  const dirAbs = join(CWD, dir)
  if (!existsSync(dirAbs)) return false
  const re = new RegExp(
    '^' +
      base
        .replace(/[.+^${}()|\\]/g, '\\$&')
        .replace(/\*/g, '[^/]*')
        .replace(/\?/g, '.') +
      '$',
  )
  let entries
  try {
    entries = readdirSync(dirAbs)
  } catch {
    return false
  }
  return entries.some((e) => re.test(e))
}

/** A single candidate path exists (glob-aware; matches files OR directories). */
function candidateExists(candidate) {
  return isGlob(candidate) ? globMatches(candidate) : existsSync(join(CWD, candidate))
}

/** Resolve presence for a check: any of accept_any / glob / path. */
function isPresent(check) {
  const candidates = check.accept_any?.length ? check.accept_any : [check.path]
  if (check.glob && globMatches(check.glob)) return true
  return candidates.some(candidateExists)
}

function loadOverlays() {
  if (!existsSync(join(CWD, PROFILE))) return { overlays: new Set(), allow: [] }
  try {
    const p = parseYaml(readFileSync(join(CWD, PROFILE), 'utf-8')) || {}
    return { overlays: new Set(p.overlays || []), allow: p.allow || [] }
  } catch {
    return { overlays: new Set(), allow: [] }
  }
}

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
  if (!existsSync(join(CWD, MANIFEST))) {
    process.stdout.write(`check-doc-set: SKIP — no manifest at ${MANIFEST}\n`)
    return 0
  }
  const manifest = parseYaml(readFileSync(join(CWD, MANIFEST), 'utf-8'))
  const { overlays } = loadOverlays()

  const present = []
  const missingMandatory = []
  const missingRecommended = []
  const na = []
  const generated = []

  for (const check of manifest.checks || []) {
    const applicable = check.applies === 'always' || overlays.has(check.applies)
    if (!applicable) {
      na.push(check)
      continue
    }
    if (isPresent(check)) {
      present.push(check)
      continue
    }
    if (check.tier === 'mandatory') missingMandatory.push(check)
    else missingRecommended.push(check)

    if (flag('--generate') && check.path.endsWith('.md')) {
      const abs = join(CWD, check.path)
      mkdirSync(dirname(abs), { recursive: true })
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
    totals: {
      applicable,
      present: present.length,
      missingMandatory: missingMandatory.length,
      missingRecommended: missingRecommended.length,
      na: na.length,
    },
    missingMandatory: missingMandatory.map((c) => c.path),
    missingRecommended: missingRecommended.map((c) => c.path),
    generated,
  }

  if (flag('--json')) {
    process.stdout.write(JSON.stringify(report, null, 2) + '\n')
  } else {
    process.stdout.write(
      `check-doc-set: ${present.length}/${applicable} applicable docs present ` +
        `(mandatory gaps: ${missingMandatory.length}, recommended gaps: ${missingRecommended.length}, n/a: ${na.length})\n`,
    )
    for (const c of missingMandatory) process.stdout.write(`    MISSING [mandatory] ${c.path}\n`)
    for (const c of missingRecommended)
      process.stdout.write(`    missing [recommended] ${c.path}\n`)
    for (const p of generated) process.stdout.write(`    + scaffolded stub: ${p}\n`)
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
