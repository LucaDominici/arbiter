#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
//
// CATALOG: P8 consistency gate. Verifies frontmatter shape + H1 presence +
// last_review ISO date on every hand-authored .md doc. Distinct from
// check-doc-links.mjs (link integrity) and check-docs.mjs (src↔docs co-change).
//
// Checks (per file):
//   - frontmatter block present with required keys (title, doc_version,
//     status, last_review, owner, canonical_id, tags, related)
//   - `last_review` matches /^\d{4}-\d{2}-\d{2}$/
//   - `status` ∈ {draft, active, deprecated, archived}
//   - `doc_version` matches /^\d+\.\d+\.\d+$/
//   - exactly one top-level H1 (`# ...`) in body
//   - if frontmatter `title` is non-empty, the H1 text matches it (case-sensitive)

import { existsSync, readFileSync, statSync } from 'node:fs'
import { join, sep, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { walkRepo } from './lib/glob-walk.mjs'

const CWD = process.cwd()

const SCAN_ROOTS = ['docs', '.claude', '.agents', '.codex', 'examples']
const ROOT_FILES = [
  'AGENTS.md',
  'README.md',
  'CODE_OF_CONDUCT.md',
  'CONTRIBUTING.md',
  'SECURITY.md',
  'GLOBAL_INVARIANTS.md',
  'OBSIDIAN.md',
]
export const SKIP_PATH_SEGMENTS = [
  `${sep}node_modules${sep}`,
  `${sep}dist${sep}`,
  `${sep}.git${sep}`,
  `${sep}.changeset${sep}`,
  `${sep}api${sep}`,
  `${sep}.coverage-tmp${sep}`,
  `${sep}.evidence${sep}`,
  `${sep}report${sep}`,
  `${sep}internal${sep}`,
  `${sep}.claude${sep}plans${sep}`,
  `${sep}.claude${sep}.task${sep}`,
]
// Auto-generated files that bypass frontmatter requirements
export const SKIP_FILENAMES = new Set([
  'INDEX.md',
  'DECISIONS.md', // generated digest (gen-adr-readme.mjs) — uses status: generated
])

const REQUIRED_KEYS = [
  'title',
  'doc_version',
  'status',
  'last_review',
  'owner',
  'canonical_id',
  'tags',
  'related',
]
const VALID_STATUS = new Set(['draft', 'active', 'deprecated', 'archived'])
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
const SEMVER = /^\d+\.\d+\.\d+$/

function shouldSkip(absPath) {
  return SKIP_PATH_SEGMENTS.some((s) => absPath.includes(s))
}

/**
 * Collect every hand-authored `.md` file under `dir` (recursively). Traversal is delegated to the
 * shared cycle-safe walkRepo (#1521/#1544); this gate's own SKIP_PATH_SEGMENTS + SKIP_FILENAMES are
 * re-applied to each returned path so the visited set is identical to the old hand-rolled walk
 * (minus the symlink-cycle bug), plus walkRepo's widened SKIP_DIRS (build/coverage/.coverage).
 */
export function walk(dir) {
  if (!existsSync(dir) || shouldSkip(dir + sep)) return []
  const out = []
  for (const rel of walkRepo(dir)) {
    const full = join(dir, rel)
    if (shouldSkip(full)) continue
    const name = rel.slice(rel.lastIndexOf('/') + 1)
    if (name.endsWith('.md') && !SKIP_FILENAMES.has(name)) out.push(full)
  }
  return out
}

function collectFiles() {
  const out = []
  for (const r of SCAN_ROOTS) out.push(...walk(join(CWD, r)))
  for (const f of ROOT_FILES) {
    const abs = join(CWD, f)
    if (existsSync(abs) && statSync(abs).isFile()) out.push(abs)
  }
  return out
}

function parseFrontmatter(content) {
  if (!content.startsWith('---')) return { present: false }
  const lines = content.split('\n')
  if (lines[0] !== '---') return { present: false }
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === '---') {
      const block = lines.slice(1, i)
      const kv = new Map()
      for (const ln of block) {
        const m = ln.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.*)$/)
        if (m) kv.set(m[1], m[2].replace(/^['"]|['"]$/g, '').trim())
      }
      return { present: true, kv, bodyStart: i + 1 }
    }
  }
  return { present: false }
}

function findH1s(content, bodyStart) {
  const lines = content.split('\n').slice(bodyStart)
  const h1s = []
  let inFence = false
  for (const ln of lines) {
    if (ln.startsWith('```')) inFence = !inFence
    if (inFence) continue
    const m = ln.match(/^#\s+(.+?)\s*$/)
    if (m) h1s.push(m[1].trim())
  }
  return h1s
}

function main() {
  const files = collectFiles()
  const errors = []
  const warnings = []

  for (const file of files) {
    const rel = relative(CWD, file)
    const content = readFileSync(file, 'utf-8')
    const fm = parseFrontmatter(content)
    if (!fm.present) {
      errors.push(`${rel}: missing frontmatter block`)
      continue
    }
    // HARD: required keys must be present.
    const missing = REQUIRED_KEYS.filter((k) => !fm.kv.has(k))
    if (missing.length > 0) {
      errors.push(`${rel}: missing frontmatter key(s): ${missing.join(', ')}`)
    }
    // HARD: last_review must be ISO date when set.
    if (
      fm.kv.has('last_review') &&
      fm.kv.get('last_review') &&
      !ISO_DATE.test(fm.kv.get('last_review'))
    ) {
      errors.push(`${rel}: last_review "${fm.kv.get('last_review')}" is not ISO date (YYYY-MM-DD)`)
    }
    // HARD: doc_version must be semver when set.
    if (
      fm.kv.has('doc_version') &&
      fm.kv.get('doc_version') &&
      !SEMVER.test(fm.kv.get('doc_version'))
    ) {
      errors.push(`${rel}: doc_version "${fm.kv.get('doc_version')}" is not semver (X.Y.Z)`)
    }
    // SOFT: status should be one of the canonical lifecycle values.
    if (fm.kv.has('status') && fm.kv.get('status') && !VALID_STATUS.has(fm.kv.get('status'))) {
      warnings.push(
        `${rel}: non-canonical status "${fm.kv.get('status')}" (canonical: ${[...VALID_STATUS].join(', ')})`,
      )
    }
    // SOFT: every doc should have an H1; multi-H1 should be reviewed.
    const h1s = findH1s(content, fm.bodyStart ?? 0)
    if (h1s.length === 0) {
      warnings.push(`${rel}: no H1 heading found in body`)
    } else if (h1s.length > 1) {
      warnings.push(`${rel}: ${h1s.length} H1 headings — exactly one preferred`)
    }
  }

  if (errors.length === 0) {
    if (warnings.length > 0) {
      process.stdout.write(
        `  check-doc-style: ${files.length} files OK; ${warnings.length} soft warning(s)\n`,
      )
      for (const w of warnings.slice(0, 20)) process.stdout.write(`    [warn] ${w}\n`)
      if (warnings.length > 20)
        process.stdout.write(`    [warn] ... +${warnings.length - 20} more\n`)
    } else {
      process.stdout.write(`  check-doc-style: all ${files.length} files OK\n`)
    }
    process.exit(0)
  }

  process.stdout.write(
    `  check-doc-style: ${errors.length} hard error(s) across ${files.length} files\n`,
  )
  for (const e of errors) process.stdout.write(`    ${e}\n`)
  if (warnings.length > 0) {
    process.stdout.write(
      `  check-doc-style: ${warnings.length} additional soft warning(s) (not failure)\n`,
    )
    for (const w of warnings.slice(0, 10)) process.stdout.write(`    [warn] ${w}\n`)
    if (warnings.length > 10) process.stdout.write(`    [warn] ... +${warnings.length - 10} more\n`)
  }
  process.exit(1)
}

// Only run main when invoked as CLI (not imported in tests).
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main()
}
