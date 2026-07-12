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

import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { parse as parseYaml } from 'yaml'
import { globToRegExp, walkRepo } from './lib/glob-walk.mjs'

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

const isGlob = (p) => /[*?\[\]]/.test(p)

/**
 * True if at least one file matches the glob pattern.
 *
 * H2 (gold-doc-capability Tranche 2): a `**`-bearing pattern (e.g.
 * `docs/architecture/**\/arc42.md`) is resolved with a real recursive repo walk
 * (scripts/lib/glob-walk.mjs `walkRepo` + `globToRegExp` — the same restricted-glob engine
 * `check-render-smoke.mjs` already uses, #1366) so subtree-nested docs (arc42/C4/ADR living
 * two-plus directories deep, e.g. a governed project's `docs/architecture/budget/`) are recognized. A
 * `**`-free pattern keeps the original single-directory `readdirSync` fast path unchanged —
 * no behavior change for any existing single-level glob check (docs/ADR/[0-9]*.md, sbom*.json,
 * docs/api/*, ...).
 */
function globMatches(pattern) {
  if (pattern.includes('**')) {
    const re = globToRegExp(pattern)
    return walkRepo(CWD).some((rel) => re.test(rel))
  }
  const dir = dirname(pattern)
  const base = pattern.slice(dir.length + 1)
  const dirAbs = resolve(CWD, dir)
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
  return isGlob(candidate) ? globMatches(candidate) : existsSync(resolve(CWD, candidate))
}

// ADR record forms (#1415 dual recognition). All anchored to the start of the filename so a
// stray "notes.txt" or "README.md" never counts as a decision record:
//   legacy bare-numeric:  001-thin-pointer.md
//   legacy ADR-prefixed:  ADR-001-thin-pointer.md / ADR-001_thin-pointer.md
//   repo-prefixed:        <PREFIX>-NNN_slug.md   (e.g. ARB-001_thin-pointer.md)
const ADR_BARE_RE = /^\d{3,}[-_].+\.md$/
const ADR_LEGACY_RE = /^ADR-\d{3,}[-_].+\.md$/i
const ADR_PREFIX_RE = /^[A-Za-z][A-Za-z0-9]*-\d{3,}[-_].+\.md$/

/** True if >=1 filename matches a decision-record form (legacy/prefixed dual recognition). */
const isAdrFilename = (e) =>
  ADR_BARE_RE.test(e) || ADR_LEGACY_RE.test(e) || ADR_PREFIX_RE.test(e)

/** True if >=1 ADR record (legacy bare/ADR-NNN or repo-prefixed <PREFIX>-NNN) lives under dir. */
function adrPresent(adrDir) {
  const dirAbs = resolve(CWD, adrDir)
  if (!existsSync(dirAbs)) return false
  let entries
  try {
    entries = readdirSync(dirAbs)
  } catch {
    return false
  }
  return entries.some(isAdrFilename)
}

/**
 * H2 (gold-doc-capability Tranche 2): the single-directory adrPresent() above is path-blind — a
 * project whose ADRs live two-plus directories deep (a governed project's real
 * `docs/architecture/budget/adr/ADR-006..014_*.md`) is invisible to it. Recursively walk the repo
 * (SKIP_DIRS-pruned) for any file whose immediate parent directory is literally named `ADR`/`adr`
 * (case-insensitive — legacy convention is uppercase, real-world nested convention is lowercase)
 * AND whose filename matches the SAME dual-recognition regexes — never a second, looser notion of
 * "is an ADR". Bounded cost: one full walk, only when `check.adr === true`.
 */
function adrPresentAnywhere() {
  for (const rel of walkRepo(CWD)) {
    const parts = rel.split('/')
    const filename = parts[parts.length - 1]
    const parentDir = parts[parts.length - 2]
    if (!parentDir || parentDir.toLowerCase() !== 'adr') continue
    if (isAdrFilename(filename)) return true
  }
  return false
}

// H3 (gold-doc-capability Tranche 1) — collaborationMode → tiers{} column resolution.
// Mirrors scripts/check-ci-tiers.mjs `resolveCm`: explicit collaborationMode > the
// soloDevMode back-compat alias (ADR-051) > default 'peer-review' (same default the rest
// of the codebase uses, src/wizard/prompts.ts DEFAULT_COLLABORATION_MODE).
const TIER_COLUMN = { 'trunk-solo': 'solo', 'peer-review': 'small', 'gated-review': 'enterprise' }

function resolveCollaborationMode(config) {
  if (config.collaborationMode) return config.collaborationMode
  if (config.enableSoloDevMode === true || config.features?.soloDevMode === true)
    return 'trunk-solo'
  return 'peer-review'
}

/** Read arbiter.json's collaborationMode (repo-root relative) and resolve the tiers{} column. */
function loadTierColumn() {
  const cfgPath = resolve(CWD, 'arbiter.json')
  if (!existsSync(cfgPath)) return TIER_COLUMN[resolveCollaborationMode({})]
  try {
    const config = JSON.parse(readFileSync(cfgPath, 'utf-8'))
    const cm = resolveCollaborationMode(config)
    return TIER_COLUMN[cm] || TIER_COLUMN[resolveCollaborationMode({})]
  } catch {
    return TIER_COLUMN[resolveCollaborationMode({})]
  }
}

/**
 * Resolve a check's requirement band for the given tiers{} column.
 *   'R' -> 'mandatory'  'r' -> 'recommended'  'o' | '-' -> 'skip' (dormant, counted as n/a)
 * Checks without a tiers{} field fall back to the legacy flat `tier:` literal (`conditional`
 * checks are unaffected either way — resolved via the `applicable` overlay check in main()).
 */
function requirementFor(check, column) {
  if (!check.tiers) return check.tier === 'mandatory' ? 'mandatory' : 'recommended'
  const cell = check.tiers[column]
  if (cell === 'R') return 'mandatory'
  if (cell === 'r') return 'recommended'
  if (cell === 'o' || cell === '-') return 'skip'
  // Unrecognized value or missing column key (manifest typo) ⇒ fail-closed (INV-96):
  // never let a malformed tiers{} cell silently drop a requirement.
  return 'mandatory'
}

/** Resolve presence for a check: any of accept_any / glob / path (ADR-aware for adr:true). */
function isPresent(check) {
  const candidates = check.accept_any?.length ? check.accept_any : [check.path]
  // ADR checks accept legacy AND repo-prefixed records; fall through to glob/accept_any too.
  // H2: also recognize an ADR subtree living anywhere in the repo (adrPresentAnywhere), not just
  // the single directory derived from this check's own glob/path.
  if (
    check.adr === true &&
    (adrPresent(dirname(check.glob || 'docs/ADR/x')) || adrPresentAnywhere())
  )
    return true
  if (check.glob && globMatches(check.glob)) return true
  return candidates.some(candidateExists)
}

function loadOverlays() {
  if (!existsSync(resolve(CWD, PROFILE))) return { overlays: new Set(), allow: [] }
  try {
    const p = parseYaml(readFileSync(resolve(CWD, PROFILE), 'utf-8')) || {}
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
  if (!existsSync(resolve(CWD, MANIFEST))) {
    process.stdout.write(`check-doc-set: SKIP — no manifest at ${MANIFEST}\n`)
    return 0
  }
  const manifest = parseYaml(readFileSync(resolve(CWD, MANIFEST), 'utf-8'))
  const { overlays } = loadOverlays()
  const tierColumn = loadTierColumn()

  const present = []
  const missingMandatory = []
  const missingRecommended = []
  const na = []
  const generated = []
  const refreshed = []

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
    if (isPresent(check)) {
      present.push(check)
      continue
    }
    if (requirement === 'mandatory') missingMandatory.push(check)
    else missingRecommended.push(check)

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
    tierColumn, // H3: which tiers{} column ('solo'|'small'|'enterprise') resolved this run
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
