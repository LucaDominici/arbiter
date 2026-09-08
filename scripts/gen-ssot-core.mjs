#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// scripts/gen-ssot-core.mjs
// #1100: generate the authoritative SSOT inventory region inside
// docs/internal/METHOD/SSOT_CORE_SET.md from the filesystem + frontmatter, replacing the
// hand-maintained list. The selection rule is the single source of truth for
// "what is an SSOT doc" and is imported by scripts/check-ssot-core.mjs so the
// generator (write) and the gate (INV-108 reverse check) can never diverge.
//
// Selection rule ("canonical, no dupes", #1100): a doc qualifies iff
//   status: active
//   AND (first kind/* tag is a backbone kind OR canonical_id is non-empty)
//   AND kind is not 'adr'            (ADRs are owned by INV-107 / docs/internal/ADR/)
//   AND it is not a generated dim-NN coverage stub (regenerated from src/kit/catalog on demand)
// Distinct from docs/INDEX.md (#1102), which is the FULL map of every doc; this
// is the curated canonical spine.
//
// Usage:
//   node scripts/gen-ssot-core.mjs           # rewrite the generated region
//   node scripts/gen-ssot-core.mjs --check   # fail (exit 1) if the region is stale
//
// Exported (for unit tests):
//   selectSsotDocs(repoRoot)            → record[]  (the load-bearing predicate)
//   buildInventory(records)             → string    (the marker-region body)
//   runCli(repoRoot, ssotPath, check)   → Promise<number>  (0 ok / 1 stale|error)

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
import { walkRepo } from './lib/glob-walk.mjs'
import { isMainModule } from './lib/run-helpers.mjs'

const BEGIN_MARKER = '<!-- BEGIN GENERATED INVENTORY -->'
const END_MARKER = '<!-- END GENERATED INVENTORY -->'

// Backbone kinds that make a doc part of the canonical spine.
const BACKBONE_KINDS = new Set(['ssot', 'governance', 'spine', 'canon', 'api', 'setup', 'method'])

// Section heading per kind, in display order. Kinds not listed are appended alphabetically.
const SECTION_ORDER = ['governance', 'method', 'setup', 'spine', 'ssot', 'canon', 'api']
const SECTION_TITLES = {
  governance: 'Governance',
  method: 'Method',
  setup: 'Entrypoints',
  spine: 'Spines',
  ssot: 'SSOT',
  canon: 'Canon',
  api: 'API',
  '': 'Other',
}

// Root-level markdown files considered (repo-root, non-recursive).
const ROOT_GLOB = /\.md$/

// ---------------------------------------------------------------------------
// Frontmatter parsing (mirrors scripts/gen-doc-index.mjs — kept local so this
// gate-time script has no cross-script import beyond check-ssot-core.mjs).
// ---------------------------------------------------------------------------

function parseFrontmatter(content) {
  if (!content.startsWith('---\n')) return {}
  const end = content.indexOf('\n---', 4)
  if (end === -1) return {}
  const block = content.slice(4, end)
  const fm = {}
  for (const line of block.split('\n')) {
    const m = line.match(/^([a-z_]+):\s*(.*)$/)
    if (!m) continue
    const raw = m[2].trim()
    if (raw.startsWith('[')) {
      fm[m[1]] = [...raw.matchAll(/'([^']+)'|"([^"]+)"/g)].map((x) => x[1] ?? x[2])
    } else {
      fm[m[1]] = raw.replace(/^['"]|['"]$/g, '')
    }
  }
  return fm
}

function firstH1(content) {
  const m = content.match(/^#\s+(.+)$/m)
  return m ? m[1].trim() : ''
}

function firstKind(tags) {
  const t = (Array.isArray(tags) ? tags : []).find((x) => x.startsWith('kind/'))
  return t ? t.slice('kind/'.length) : ''
}

/**
 * Recursively collect absolute paths of .md files under dir.
 * Delegates to the shared hardened walker (lstat + skip-symlink + visited-inode
 * cycle guard, #1521) instead of a hand-rolled statSync recursion — a symlinked
 * directory cycle in docs/ would otherwise infinite-recurse. The shared SKIP_DIRS
 * additionally prunes coverage/ (the dim-NN stub tree), which selectSsotDocs already
 * excludes below, so the generated SSOT inventory is byte-identical.
 */
function walkMarkdown(dir) {
  return walkRepo(dir)
    .filter((rel) => rel.endsWith('.md'))
    .map((rel) => join(dir, rel))
}

// ---------------------------------------------------------------------------
// Exported API
// ---------------------------------------------------------------------------

/**
 * Select the canonical SSOT docs under repoRoot. Returns records sorted by
 * relPath (repo-root-relative, forward slashes), each: { relPath, kind, title }.
 */
export function selectSsotDocs(repoRoot) {
  const files = []
  const docsDir = join(repoRoot, 'docs')
  if (existsSync(docsDir)) files.push(...walkMarkdown(docsDir))
  // Repo-root-level markdown (AGENTS.md, README.md, OBSIDIAN.md, ...).
  for (const entry of readdirSync(repoRoot)) {
    if (!ROOT_GLOB.test(entry)) continue
    const full = join(repoRoot, entry)
    if (statSync(full).isFile()) files.push(full)
  }

  const records = []
  for (const file of files) {
    const relPath = relative(repoRoot, file).split(sep).join('/')
    // Generated dim-NN coverage stubs (regenerated from src/kit/catalog) never join the SSOT set.
    if (relPath.startsWith('docs/REFERENCE/coverage/')) continue
    const content = readFileSync(file, 'utf-8')
    const fm = parseFrontmatter(content)
    if (fm.status !== 'active') continue
    const kind = firstKind(fm.tags)
    if (kind === 'adr') continue // ADRs owned by INV-107
    // Runbooks owned by INV-148, and excluded here for the same reason ADRs are: a runbook is a
    // procedure for one failure, not a source of truth about the system. It joined this set only
    // because #2480 wave 8 gave it an RB-NN canonical_id, which exposed that `canonical_id` was
    // doing double duty — "citable" and "SSOT core" are different properties and this is the first
    // case where they diverge. Left unfixed the bound would erode by design: INV-148 ratchets the
    // uncovered-operational debt DOWN, so success means many more runbooks, each silently enlarging
    // the surface INV-108 exists to keep bounded.
    if (kind === 'runbook') continue
    const canonicalId = fm.canonical_id || ''
    if (!BACKBONE_KINDS.has(kind) && canonicalId === '') continue
    records.push({
      relPath,
      kind,
      title: (fm.title || firstH1(content) || relPath).replace(/\|/g, '\\|'),
    })
  }
  return records.sort((a, b) => a.relPath.localeCompare(b.relPath))
}

/** Build the generated inventory region body (between the markers). */
export function buildInventory(records) {
  const byKind = new Map()
  for (const r of records) {
    if (!byKind.has(r.kind)) byKind.set(r.kind, [])
    byKind.get(r.kind).push(r)
  }
  const kinds = [...byKind.keys()].sort((a, b) => {
    const ia = SECTION_ORDER.indexOf(a)
    const ib = SECTION_ORDER.indexOf(b)
    if (ia !== -1 && ib !== -1) return ia - ib
    if (ia !== -1) return -1
    if (ib !== -1) return 1
    return a.localeCompare(b)
  })
  const sections = []
  for (const kind of kinds) {
    const heading = SECTION_TITLES[kind] ?? kind
    const rows = byKind
      .get(kind)
      .sort((a, b) => a.relPath.localeCompare(b.relPath))
      .map((r) => `- \`${r.relPath}\` — ${r.title}`)
      .join('\n')
    sections.push(`### ${heading}\n\n${rows}`)
  }
  return sections.join('\n\n')
}

/** Replace the content between BEGIN/END markers with `region`. */
function spliceRegion(doc, region) {
  const begin = doc.indexOf(BEGIN_MARKER)
  const end = doc.indexOf(END_MARKER)
  if (begin === -1 || end === -1 || end < begin) {
    throw new Error(
      `SSOT_CORE_SET.md is missing the generated-region markers ` +
        `(${BEGIN_MARKER} / ${END_MARKER}).`,
    )
  }
  // Reject duplicate markers — splicing only the first pair would silently leave
  // a stale second region behind and let --check pass against drifted content.
  if (doc.indexOf(BEGIN_MARKER, begin + 1) !== -1 || doc.indexOf(END_MARKER, end + 1) !== -1) {
    throw new Error(
      'SSOT_CORE_SET.md has duplicate generated-region markers — expected exactly one pair.',
    )
  }
  const before = doc.slice(0, begin + BEGIN_MARKER.length)
  const after = doc.slice(end)
  return `${before}\n\n${region}\n\n${after}`
}

/**
 * Write (or --check) the generated region inside ssotPath.
 * Returns 0 ok / 1 stale|error. Fail-closed (INV-96): errors return 1.
 */
export async function runCli(repoRoot, ssotPath, check) {
  try {
    if (!existsSync(ssotPath)) {
      process.stdout.write('gen-ssot-core: no SSOT_CORE_SET.md found — skipping (bootstrap mode)\n')
      return 0
    }
    const current = readFileSync(ssotPath, 'utf-8')
    const region = buildInventory(selectSsotDocs(repoRoot))
    const generated = spliceRegion(current, region)
    if (check) {
      if (current !== generated) {
        process.stderr.write(
          'docs/internal/METHOD/SSOT_CORE_SET.md inventory is stale. ' +
            'Run `node scripts/gen-ssot-core.mjs` and commit the result.\n',
        )
        return 1
      }
      process.stdout.write('docs/internal/METHOD/SSOT_CORE_SET.md inventory is up to date.\n')
      return 0
    }
    writeFileSync(ssotPath, generated)
    process.stdout.write(`Wrote inventory region to ${ssotPath}\n`)
    return 0
  } catch (err) {
    process.stderr.write(`gen-ssot-core: ${err instanceof Error ? err.message : String(err)}\n`)
    return 1
  }
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

const isMain = isMainModule(import.meta.url)
if (isMain) {
  const repoRoot = resolve('.')
  const ssotPath = join(repoRoot, 'docs', 'internal', 'METHOD', 'SSOT_CORE_SET.md')
  runCli(repoRoot, ssotPath, process.argv.includes('--check'))
    .then((code) => process.exit(code))
    .catch((err) => {
      process.stderr.write(`gen-ssot-core: ${err instanceof Error ? err.message : String(err)}\n`)
      process.exit(1)
    })
}
