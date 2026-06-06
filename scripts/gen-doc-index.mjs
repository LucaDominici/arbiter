#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// scripts/gen-doc-index.mjs
// #1102: generate docs/INDEX.md from doc frontmatter — a single discoverable
// inventory of every governance doc, grouped by directory, with real markdown links
// (Obsidian-friendly: clickable, graph-wiring, GitHub/VitePress-portable).
//
// Usage:
//   node scripts/gen-doc-index.mjs           # (re)write docs/INDEX.md
//   node scripts/gen-doc-index.mjs --check   # fail (exit 1) if docs/INDEX.md is stale
//
// Exported functions (for unit tests):
//   collectDocs(docsDir, indexPath) → record[]
//   buildIndex(records)             → string
//   runCli(docsDir, indexPath, check) → Promise<number>  (0 = ok, 1 = error/stale)
//
// Uses process.cwd() as the repo root (matching other gate scripts).

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

// Directories under docs/ whose contents are excluded from the inventory.
const SKIP_SEGMENTS = new Set(['report'])

/** Return the Set of git-tracked paths (relative to repo root) under docs/. */
function gitTrackedDocPaths(repoRoot) {
  try {
    const out = execFileSync('git', ['ls-files', 'docs/'], { cwd: repoRoot, encoding: 'utf-8' })
    return new Set(out.split('\n').filter(Boolean))
  } catch {
    return null // git not available — fall back to unfiltered walk
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Parse a leading `---`-delimited YAML-ish frontmatter block.
 *  Returns a map of scalar keys and, for inline-array values, a string[]. */
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
      // Parse YAML inline array: ['a', 'b'] or ["a", "b"]
      fm[m[1]] = [...raw.matchAll(/'([^']+)'|"([^"]+)"/g)].map((x) => x[1] ?? x[2])
    } else {
      fm[m[1]] = raw.replace(/^['"]|['"]$/g, '')
    }
  }
  return fm
}

/** First H1 text, used as a title fallback for frontmatter-less docs. */
function firstH1(content) {
  const m = content.match(/^#\s+(.+)$/m)
  return m ? m[1].trim() : ''
}

/** Recursively collect .md files under dir (excluding SKIP_SEGMENTS + indexPath). */
function walkMarkdown(dir, indexPath) {
  const out = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      if (SKIP_SEGMENTS.has(entry)) continue
      out.push(...walkMarkdown(full, indexPath))
    } else if (entry.endsWith('.md') && full !== indexPath) {
      out.push(full)
    }
  }
  return out
}

/** Format one table row. */
function tableRow(r) {
  return `| [${r.title}](${r.relPath}) | ${r.id || '—'} | ${r.status} | ${r.kind || '—'} |`
}

// ---------------------------------------------------------------------------
// Exported API
// ---------------------------------------------------------------------------

/**
 * Collect and parse all docs under docsDir.
 * Returns records sorted alphabetically by relPath, each with:
 *   relPath  – path relative to docsDir (forward slashes)
 *   title    – from frontmatter, first H1, or relPath (pipe-escaped)
 *   id       – canonical_id or ''
 *   status   – from frontmatter or '—'
 *   kind     – first 'kind/*' tag from the tags array, or ''
 *   tags     – full string[] of tags
 */
export function collectDocs(docsDir, indexPath) {
  const repoRoot = resolve(docsDir, '..')
  const tracked = gitTrackedDocPaths(repoRoot)
  return walkMarkdown(docsDir, indexPath)
    .filter((file) => {
      if (tracked === null) return true
      const rel = relative(repoRoot, file).split(sep).join('/')
      return tracked.has(rel)
    })
    .sort()
    .map((file) => {
      const content = readFileSync(file, 'utf-8')
      const fm = parseFrontmatter(content)
      const relPath = relative(docsDir, file).split(sep).join('/')
      const tags = Array.isArray(fm.tags) ? fm.tags : []
      return {
        relPath,
        title: (fm.title || firstH1(content) || relPath).replace(/\|/g, '\\|'),
        id: fm.canonical_id || '',
        status: fm.status || '—',
        kind: tags.find((t) => t.startsWith('kind/')) ?? '',
        tags,
      }
    })
}

/**
 * Build the grouped INDEX.md content from doc records.
 * Groups by top-level directory; root-level docs (directly under docs/) appear first
 * under a '## docs' heading. Each entry is a real markdown link for Obsidian + GitHub.
 */
export function buildIndex(records) {
  // Group by top-level directory (empty string = root level docs)
  const groups = new Map()
  for (const r of records) {
    const parts = r.relPath.split('/')
    const key = parts.length > 1 ? parts[0] : ''
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(r)
  }

  const header =
    `# Documentation Index\n\n` +
    `> Generated by \`scripts/gen-doc-index.mjs\` from doc frontmatter. Do not edit by hand;\n` +
    `> run \`node scripts/gen-doc-index.mjs\` after adding or relabeling a doc.\n\n` +
    `${records.length} documents.\n\n`

  const TABLE_HEADER =
    `| title | canonical_id | status | kind |\n` + `|-------|--------------|--------|------|\n`

  // Root-level files first, then subdirectories sorted alphabetically
  const rootDocs = groups.get('') ?? []
  const dirGroups = [...groups.entries()]
    .filter(([k]) => k !== '')
    .sort(([a], [b]) => a.localeCompare(b))

  const sections = []

  if (rootDocs.length > 0) {
    sections.push(`## docs\n\n` + TABLE_HEADER + rootDocs.map(tableRow).join('\n') + '\n')
  }

  for (const [dir, docs] of dirGroups) {
    sections.push(`## ${dir}\n\n` + TABLE_HEADER + docs.map(tableRow).join('\n') + '\n')
  }

  return header + sections.join('\n')
}

/**
 * Execute the write or check logic.
 * Returns 0 on success, 1 on stale/error. Does not call process.exit — exported for testing.
 * Fail-closed (INV-96): IO/parse errors return 1 rather than producing a partial index.
 */
export async function runCli(docsDir, indexPath, check) {
  try {
    const records = collectDocs(docsDir, indexPath)
    const generated = buildIndex(records)
    if (check) {
      const current = existsSync(indexPath) ? readFileSync(indexPath, 'utf-8') : ''
      if (current !== generated) {
        process.stderr.write(
          'docs/INDEX.md is stale. Run `node scripts/gen-doc-index.mjs` and commit the result.\n',
        )
        return 1
      }
      process.stdout.write('docs/INDEX.md is up to date.\n')
      return 0
    }
    writeFileSync(indexPath, generated)
    process.stdout.write(`Wrote ${indexPath}\n`)
    return 0
  } catch (err) {
    process.stderr.write(`gen-doc-index: ${err instanceof Error ? err.message : String(err)}\n`)
    return 1
  }
}

// ---------------------------------------------------------------------------
// CLI entry point — guarded so imports don't trigger side-effects
// ---------------------------------------------------------------------------

const isMain = process.argv[1] === fileURLToPath(import.meta.url)

if (isMain) {
  // Use process.cwd() as repo root (matches check-doc-links.mjs and other gate scripts)
  const repoRoot = resolve('.')
  const docsDir = join(repoRoot, 'docs')
  const indexPath = join(docsDir, 'INDEX.md')
  runCli(docsDir, indexPath, process.argv.includes('--check'))
    .then((code) => process.exit(code))
    .catch((err) => {
      // Safety net for unexpected promise rejections (INV-96 fail-closed).
      process.stderr.write(`gen-doc-index: ${err instanceof Error ? err.message : String(err)}\n`)
      process.exit(1)
    })
}
