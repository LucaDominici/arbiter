#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
//
// CATALOG: idempotent frontmatter codemod for hand-authored .md docs.
// Cannot fold into scripts/check-docs.mjs (read-only gate; no write surface).
// Cannot fold into scripts/check-doc-links.mjs (link integrity; different
// concern). Line-based YAML merger avoids pulling a yaml lib (the only
// first-party consumer would be this script + the test).
//
// Usage:
//   node scripts/docs-add-frontmatter.mjs --dry-run
//   node scripts/docs-add-frontmatter.mjs --check    # exit 1 if any change pending
//   node scripts/docs-add-frontmatter.mjs --apply
//   node scripts/docs-add-frontmatter.mjs --apply --dirs docs/,.claude/
//
// Schema (locked, see plan §B.1):
//   title:        "Document Title"        # from first H1 if absent
//   doc_version:  "1.0.0"                 # CONTENT semver (distinct from product semver)
//   status:       active                  # draft | active | deprecated | archived
//   last_review:  "YYYY-MM-DD"            # today (ISO date)
//   owner:        ""                      # optional; omitted when empty
//   canonical_id: ""                      # optional SSOT id; omitted when empty
//   tags:         []                      # populated by P5 backfill, not here
//   related:      []                      # optional

import { readFileSync, writeFileSync, statSync, readdirSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import { parseArgs } from 'node:util'

const REPO_ROOT = resolve(new URL('..', import.meta.url).pathname)

// Roots to walk by default. Override via --dirs.
const DEFAULT_ROOTS = ['docs', '.claude', '.agents', '.codex', 'examples', 'website']

// Files to consider at repo root.
const ROOT_FILES = [
  'AGENTS.md',
  'README.md',
  'CODE_OF_CONDUCT.md',
  'CONTRIBUTING.md',
  'SECURITY.md',
  'GLOBAL_INVARIANTS.md',
]

// HARD SKIP: never touch these paths (substring match).
const HARD_SKIP_PATHS = [
  '/node_modules/',
  '/dist/',
  '/.git/',
  '/.coverage-tmp/',
  '/.evidence/',
  '/report/',
  '/.changeset/',
  '/api/',
]

// HARD SKIP: never touch these filenames (basename match).
const HARD_SKIP_FILENAMES = new Set(['CHANGELOG.md', 'LICENSE', 'NOTICE'])

// Required keys in the locked schema.
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

const TOP_LEVEL_KEY_PATTERN = /^([A-Za-z_][A-Za-z0-9_]*)\s*:/
const H1_PATTERN = /^#\s+(.+?)\s*$/

function todayISO() {
  return new Date().toISOString().slice(0, 10)
}

function isHardSkipped(absPath) {
  for (const seg of HARD_SKIP_PATHS) {
    if (absPath.includes(seg)) return true
  }
  const base = absPath.split(sep).at(-1) ?? ''
  if (HARD_SKIP_FILENAMES.has(base)) return true
  return false
}

function listMarkdownFiles(roots) {
  const out = []
  const walk = (dir) => {
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      const p = join(dir, e.name)
      if (isHardSkipped(p)) continue
      if (e.isDirectory()) walk(p)
      else if (e.isFile() && e.name.endsWith('.md')) out.push(p)
    }
  }
  for (const r of roots) {
    const absR = resolve(REPO_ROOT, r)
    let s
    try {
      s = statSync(absR)
    } catch {
      continue
    }
    if (s.isDirectory()) walk(absR)
    else if (s.isFile() && absR.endsWith('.md') && !isHardSkipped(absR)) out.push(absR)
  }
  return out
}

// Returns the index range of the existing frontmatter block (excluding fences)
// or null if no block is present.
function parseFrontmatterBlock(content) {
  if (!content.startsWith('---')) return null
  const lines = content.split('\n')
  if (lines[0] !== '---') return null
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === '---') {
      return { startIdx: 0, endIdx: i, bodyStartIdx: i + 1, lines }
    }
  }
  return null
}

function existingTopLevelKeys(blockLines) {
  const keys = new Set()
  for (const line of blockLines) {
    const match = line.match(TOP_LEVEL_KEY_PATTERN)
    if (match) keys.add(match[1])
  }
  return keys
}

function deriveTitle(content, parsedBlock) {
  const bodyStart = parsedBlock ? parsedBlock.bodyStartIdx : 0
  const lines = content.split('\n').slice(bodyStart)
  for (const line of lines) {
    const match = line.match(H1_PATTERN)
    if (match) return match[1].replace(/"/g, '\\"')
  }
  return ''
}

function emitDefaultValue(key, title) {
  switch (key) {
    case 'title':
      return title ? `"${title}"` : '""'
    case 'doc_version':
      return '"1.0.0"'
    case 'status':
      return 'active'
    case 'last_review':
      return `"${todayISO()}"`
    case 'owner':
      return '""'
    case 'canonical_id':
      return '""'
    case 'tags':
      return '[]'
    case 'related':
      return '[]'
    default:
      return '""'
  }
}

function buildNewBlock(title) {
  const out = ['---']
  for (const key of REQUIRED_KEYS) {
    out.push(`${key}: ${emitDefaultValue(key, title)}`)
  }
  out.push('---')
  return out
}

function transform(content) {
  const parsed = parseFrontmatterBlock(content)
  const title = deriveTitle(content, parsed)

  if (!parsed) {
    const block = buildNewBlock(title)
    const separator = content.startsWith('\n') ? '\n' : '\n\n'
    return block.join('\n') + separator + content
  }

  const blockLines = parsed.lines.slice(parsed.startIdx + 1, parsed.endIdx)
  const present = existingTopLevelKeys(blockLines)
  const missing = REQUIRED_KEYS.filter((k) => !present.has(k))
  if (missing.length === 0) return content

  const insertions = missing.map((k) => `${k}: ${emitDefaultValue(k, title)}`)
  const before = parsed.lines.slice(0, parsed.endIdx)
  const after = parsed.lines.slice(parsed.endIdx)
  return [...before, ...insertions, ...after].join('\n')
}

const { values } = parseArgs({
  options: {
    'dry-run': { type: 'boolean', default: false },
    check: { type: 'boolean', default: false },
    apply: { type: 'boolean', default: false },
    dirs: { type: 'string' },
    help: { type: 'boolean', short: 'h' },
  },
})

if (values.help || (!values['dry-run'] && !values.check && !values.apply)) {
  console.error(
    'Usage: docs-add-frontmatter.mjs (--dry-run | --check | --apply) [--dirs docs/,.claude/]\n' +
      '  --dry-run  list files that would change without writing\n' +
      '  --check    exit 1 if any file would change (CI-friendly)\n' +
      '  --apply    write changes to disk\n' +
      '  --dirs     comma-separated roots (defaults to canonical set)',
  )
  process.exit(values.help ? 0 : 2)
}

const customRoots = values.dirs
  ? values.dirs
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  : null
const roots = customRoots ?? [...DEFAULT_ROOTS, ...ROOT_FILES]
const files = listMarkdownFiles(roots)

let changedCount = 0
let unchangedCount = 0
const changedFiles = []

for (const f of files) {
  const original = readFileSync(f, 'utf-8')
  const next = transform(original)
  if (next === original) {
    unchangedCount++
    continue
  }
  changedCount++
  changedFiles.push(f)
  if (values.apply) writeFileSync(f, next)
}

const mode = values.apply ? 'APPLY' : values.check ? 'CHECK' : 'DRY-RUN'
console.error(`docs-add-frontmatter [${mode}]`)
console.error(`  scanned   : ${files.length}`)
console.error(`  unchanged : ${unchangedCount}`)
console.error(`  changed   : ${changedCount}`)
if (changedCount > 0 && !values.apply) {
  const sample = changedFiles.slice(0, 20)
  for (const f of sample) console.error(`    ${f.replace(REPO_ROOT + sep, '')}`)
  if (changedFiles.length > sample.length) {
    console.error(`    ... +${changedFiles.length - sample.length} more`)
  }
}

if (values.check && changedCount > 0) process.exit(1)
