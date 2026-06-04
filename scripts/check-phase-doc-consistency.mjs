#!/usr/bin/env node
// CATALOG: enforces INV-113 — task state lives in one .claude/.task/status.json, no legacy dotfiles.
// CATALOG: rejected fold-in into check-catalog-agents-parity.mjs because that checks INV↔doc title
// CATALOG: parity, a doc-text concern, not source-code dotfile-literal scanning + status.json schema.
// arbiter — INV-113: single authoritative task-phase document.
//
// Task state is sourced from ONE document pair — `.claude/.task/status.json` (+ `log.md`) — not
// the legacy flat `.claude/.task-*` dotfiles. This gate enforces that no source or template CODE
// reads or writes the legacy flat dotfiles. The migration shim (`src/commands/task-state.ts`) is
// allowlisted because it intentionally consumes-and-deletes legacy files during migration.
//
// Static check (always): no legacy dotfile-name literal in src/** outside the shim.
// Runtime check (best-effort): if `.claude/.task/status.json` exists, it must be valid JSON with
// a `phase` field — i.e. the unified document is well-formed.
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs'
import { join, relative } from 'node:path'

const repoRoot = process.cwd()
const SRC = join(repoRoot, 'src')

// Precise alternation: \.task-(phase-history|handoff-ready|phase|tier|plan|id). The gitignore glob
// `.task-*` and the directory pattern `.claude/.task/` are intentionally NOT matched, so ignore
// patterns never false-positive.
const SUFFIXES = ['phase-history', 'handoff-ready', 'phase', 'tier', 'plan', 'id']
const SCAN_RE = new RegExp(`\\.task-(?:${SUFFIXES.join('|')})\\b`)

// Files that may legitimately reference the legacy names (the migration shim only).
const ALLOWLIST = new Set(['src/commands/task-state.ts'])
const EXTS = ['.ts', '.mjs', '.ejs']

function walk(dir) {
  const out = []
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    const st = statSync(full)
    if (st.isDirectory()) out.push(...walk(full))
    else if (EXTS.some((e) => full.endsWith(e))) out.push(full)
  }
  return out
}

const violations = []
for (const file of walk(SRC)) {
  const rel = relative(repoRoot, file)
  if (ALLOWLIST.has(rel)) continue
  const lines = readFileSync(file, 'utf-8').split('\n')
  lines.forEach((line, i) => {
    if (SCAN_RE.test(line)) violations.push(`${rel}:${i + 1}  ${line.trim().slice(0, 100)}`)
  })
}

let failed = false
if (violations.length > 0) {
  failed = true
  console.error('INV-113: legacy `.task-*` flat-dotfile reference(s) found in source/templates:')
  for (const v of violations) console.error('  ' + v)
  console.error(
    '\nTask state lives in `.claude/.task/status.json`. Use readTaskState / readUnifiedState / ' +
      'arbiter task get instead of the flat dotfiles (only src/commands/task-state.ts may name them).',
  )
}

// Runtime well-formedness (best-effort — the document is gitignored and usually absent in CI).
const statusPath = join(repoRoot, '.claude', '.task', 'status.json')
if (existsSync(statusPath)) {
  try {
    const state = JSON.parse(readFileSync(statusPath, 'utf-8'))
    if (typeof state.phase !== 'string' || state.phase.length === 0) {
      failed = true
      console.error(`INV-113: ${relative(repoRoot, statusPath)} is missing a valid "phase" field.`)
    }
  } catch (err) {
    failed = true
    console.error(`INV-113: ${relative(repoRoot, statusPath)} is not valid JSON — ${err.message}`)
  }
}

if (failed) process.exit(1)
console.log('INV-113: OK — single authoritative task-phase document; no legacy dotfile references.')
