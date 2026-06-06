#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// CATALOG: Validates wiki/ directory for broken wikilinks, orphan pages, stale source hashes, and citation integrity (INV-116).
// CATALOG: Rejected fold-in into check-doc-links.mjs because [[wikilinks]] have distinct syntax and resolution semantics from markdown links.
// CATALOG: Rejected fold-in into check-ssot-core.mjs because wiki/ is generated content managed separately from the curated SSOT core.
//
// INV-116: Enforces wiki/ health across four dimensions:
//   1. broken-link: every [[WikiPage]] reference resolves to wiki/{page}.md
//   2. orphan: every wiki page is reachable from wiki/INDEX.md via wikilinks (INDEX.md itself exempt)
//   3. stale: every wiki page's source_sha matches git hash-object of its source file
//   4. citation: every wiki page has a non-empty source: field pointing to a git-tracked path
//
// Usage:
//   node scripts/check-wiki-lint.mjs              # run against wiki/ in CWD
//   node scripts/check-wiki-lint.mjs --wiki-dir <dir>   # run against a specific wiki dir
//   node scripts/check-wiki-lint.mjs --check            # alias for standard usage
// Exits 0 if clean, exits 1 if any violation found.

import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'

try {
  const args = process.argv.slice(2)
  const wikiDirArg =
    args.find((a) => a.startsWith('--wiki-dir='))?.split('=')[1] ??
    (args[args.indexOf('--wiki-dir') + 1] !== undefined &&
    !args[args.indexOf('--wiki-dir') + 1].startsWith('-')
      ? args[args.indexOf('--wiki-dir') + 1]
      : null)
  const root = process.cwd()
  const WIKI_DIR = wikiDirArg ? resolve(wikiDirArg) : join(root, 'wiki')

  // Bootstrap mode: exit 0 if wiki/ doesn't exist or is empty
  if (!existsSync(WIKI_DIR)) {
    process.stdout.write('  check-wiki-lint: wiki/ not found — skipping (bootstrap mode)\n')
    process.exit(0)
  }

  const mdFiles = readdirSync(WIKI_DIR).filter((f) => f.endsWith('.md'))
  if (mdFiles.length === 0) {
    process.stdout.write('  check-wiki-lint: wiki/ is empty — skipping (bootstrap mode)\n')
    process.exit(0)
  }

  // ── Frontmatter parser ────────────────────────────────────────────────────────

  function parseFrontmatter(text) {
    if (!text.startsWith('---\n')) return {}
    const end = text.indexOf('\n---', 4)
    if (end === -1) return {}
    const fm = {}
    for (const line of text.slice(4, end).split('\n')) {
      const colon = line.indexOf(':')
      if (colon === -1) continue
      const key = line.slice(0, colon).trim()
      const raw = line.slice(colon + 1).trim()
      fm[key] = raw.replace(/^['"]|['"]$/g, '')
    }
    return fm
  }

  // ── Wikilink extractor ────────────────────────────────────────────────────────

  function extractWikilinks(text) {
    const links = []
    for (const m of text.matchAll(/\[\[([^\]]+?)\]\]/g)) {
      const name = m[1].trim()
      if (name.length > 0) links.push(name)
    }
    return links
  }

  // ── Page slug normalization (filename without .md, lowercased) ─────────────

  function slug(filename) {
    return filename.replace(/\.md$/, '').toLowerCase()
  }

  // ── Load all wiki pages ───────────────────────────────────────────────────────

  const pages = new Map() // slug → { file, fm, links }
  for (const file of mdFiles) {
    const text = readFileSync(join(WIKI_DIR, file), 'utf-8')
    const fm = parseFrontmatter(text)
    const links = extractWikilinks(text).map((l) => l.toLowerCase())
    pages.set(slug(file), { file, fm, links })
  }

  let violations = 0

  // ── Check 1: broken wikilinks ─────────────────────────────────────────────────

  for (const [, { file, links }] of pages) {
    for (const link of links) {
      if (!pages.has(link)) {
        process.stdout.write(
          `  check-wiki-lint [broken-link]: wiki/${file} references [[${link}]] which does not exist\n`,
        )
        violations++
      }
    }
  }

  // ── Check 2: orphan pages (BFS reachability from INDEX.md) ───────────────────

  const indexSlug = 'index'
  if (!pages.has(indexSlug)) {
    process.stdout.write(
      `  check-wiki-lint [orphan]: wiki/INDEX.md not found — cannot check reachability\n`,
    )
    violations++
  } else {
    const reachable = new Set([indexSlug])
    const queue = [indexSlug]
    while (queue.length > 0) {
      const current = queue.shift()
      const page = pages.get(current)
      if (!page) continue
      for (const link of page.links) {
        if (!reachable.has(link) && pages.has(link)) {
          reachable.add(link)
          queue.push(link)
        }
      }
    }
    for (const [s, { file }] of pages) {
      if (s === indexSlug) continue // INDEX.md is exempt (it's the root)
      if (!reachable.has(s)) {
        process.stdout.write(
          `  check-wiki-lint [orphan]: wiki/${file} is unreachable from INDEX.md (no inbound links)\n`,
        )
        violations++
      }
    }
  }

  // ── Check 3: stale source_sha ─────────────────────────────────────────────────

  for (const [, { file, fm }] of pages) {
    const sourcePath = fm['source']
    const sourceSha = fm['source_sha']
    if (!sourcePath || !sourceSha) continue // citation-integrity handles missing source
    const absSource = join(root, sourcePath)
    if (!existsSync(absSource)) continue // citation-integrity will catch this
    try {
      const actualSha = execFileSync('git', ['hash-object', absSource], {
        encoding: 'utf-8',
        cwd: root,
      }).trim()
      if (actualSha !== sourceSha) {
        process.stdout.write(
          `  check-wiki-lint [stale]: wiki/${file} source_sha is stale\n` +
            `    expected ${actualSha} (current), got ${sourceSha} (recorded)\n`,
        )
        violations++
      }
    } catch {
      // git not available or hash failed — skip stale check for this file
    }
  }

  // ── Check 4: citation integrity ───────────────────────────────────────────────

  let trackedFiles = new Set()
  try {
    const lsOutput = execFileSync('git', ['ls-files', '--', 'docs/'], {
      encoding: 'utf-8',
      cwd: root,
    })
    trackedFiles = new Set(lsOutput.trim().split('\n').filter(Boolean))
  } catch {
    // git not available — skip citation check
  }

  for (const [, { file, fm }] of pages) {
    if (slug(file) === 'index') continue // INDEX.md is a synthetic page — no single source
    const sourcePath = fm['source']
    if (!sourcePath) {
      process.stdout.write(
        `  check-wiki-lint [citation]: wiki/${file} missing source: frontmatter field\n`,
      )
      violations++
      continue
    }
    if (trackedFiles.size > 0 && !trackedFiles.has(sourcePath)) {
      process.stdout.write(
        `  check-wiki-lint [citation]: wiki/${file} source: '${sourcePath}' not tracked by git\n`,
      )
      violations++
    }
  }

  // ── Result ────────────────────────────────────────────────────────────────────

  if (violations === 0) {
    process.stdout.write(`  check-wiki-lint: ${mdFiles.length} wiki pages OK\n`)
    process.exit(0)
  } else {
    process.stdout.write(`  check-wiki-lint: ${violations} violation(s) found\n`)
    process.exit(1)
  }
} catch (err) {
  process.stdout.write(
    `  check-wiki-lint: fatal — ${err instanceof Error ? err.message : String(err)}\n`,
  )
  process.exit(1)
}
