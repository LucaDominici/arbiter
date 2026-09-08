#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// CATALOG: Compiles SSOT-core docs into wiki/ (Obsidian-compatible markdown + wikilinks + citations).
// CATALOG: Rejected fold-in into gen-doc-index.mjs because wiki/ is a multi-file structured output vs single INDEX.md.
// CATALOG: Rejected fold-in into gen-ssot-core.mjs because wiki compilation is a reader-facing artifact, not a SSOT inventory.
//
// Karpathy LLM-Wiki pattern: static compiler (no LLM API calls), deterministic, citation-backed.
//
// Usage:
//   node scripts/gen-wiki.mjs               # build wiki/ from docs/
//   node scripts/gen-wiki.mjs --check       # fail if wiki/ is stale
//   node scripts/gen-wiki.mjs --changed     # incremental: only stale or missing pages
//   node scripts/gen-wiki.mjs query <terms> # keyword search over wiki pages
//   node scripts/gen-wiki.mjs --wiki-dir <dir> # write/check a non-default vault dir (#1979)

import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync, rmSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

try {
  const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))
  const args = process.argv.slice(2)
  // #1979: the vault orchestrator's --vault-path option needs gen-wiki to
  // target a non-default vault dir — mirrors check-wiki-lint.mjs's --wiki-dir.
  const wikiDirFlagIdx = args.indexOf('--wiki-dir')
  const wikiDirArg =
    args.find((a) => a.startsWith('--wiki-dir='))?.split('=')[1] ??
    (wikiDirFlagIdx !== -1 &&
    args[wikiDirFlagIdx + 1] !== undefined &&
    !args[wikiDirFlagIdx + 1].startsWith('-')
      ? args[wikiDirFlagIdx + 1]
      : null)
  const WIKI_DIR = wikiDirArg ? resolve(wikiDirArg) : join(ROOT, 'wiki')
  const DOCS_DIR = join(ROOT, 'docs')

  const isCheck = args.includes('--check')
  const isChanged = args.includes('--changed')
  const isQuery = args[0] === 'query'
  const queryTerms = isQuery ? args.slice(1).join(' ') : ''

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
      let raw = line.slice(colon + 1).trim()
      if (raw.startsWith('[')) {
        fm[key] = [...raw.matchAll(/'([^']+)'|"([^"]+)"/g)].map((m) => m[1] ?? m[2])
      } else {
        fm[key] = raw.replace(/^['"]|['"]$/g, '')
      }
    }
    return fm
  }

  // ── Collect source docs (git ls-files for tracked docs/) ─────────────────────

  function collectSourceDocs() {
    try {
      const output = execFileSync('git', ['ls-files', '--', 'docs/'], {
        encoding: 'utf-8',
        cwd: ROOT,
      })
      return output
        .trim()
        .split('\n')
        .filter((f) => f.endsWith('.md') && !f.includes('ADR/') && f !== 'docs/INDEX.md')
    } catch {
      // fallback: walk docs/ directly
      const files = []
      function walk(dir) {
        for (const f of readdirSync(dir, { withFileTypes: true })) {
          const full = join(dir, f.name)
          if (f.isDirectory()) {
            walk(full)
          } else if (f.name.endsWith('.md') && !full.includes(`${sep}ADR${sep}`))
            files.push(relative(ROOT, full))
        }
      }
      walk(DOCS_DIR)
      return files
    }
  }

  // ── Page slug from source path ────────────────────────────────────────────────

  function pageSlug(sourcePath) {
    // e.g. docs/METHOD/ENGINEERING_DEFAULTS.md → engineering-defaults
    return sourcePath
      .replace(/^docs\//, '')
      .replace(/\.md$/, '')
      .replace(/[/\\]/g, '-')
      .replace(/_/g, '-')
      .toLowerCase()
  }

  // ── Git hash of a file ────────────────────────────────────────────────────────

  function gitHash(absPath) {
    try {
      return execFileSync('git', ['hash-object', absPath], { encoding: 'utf-8', cwd: ROOT }).trim()
    } catch {
      return '0000000000000000000000000000000000000000'
    }
  }

  function staleSources(sources) {
    return sources.filter((src) => {
      const wikiPage = join(WIKI_DIR, `${pageSlug(src)}.md`)
      if (!existsSync(wikiPage)) return true
      const pageFm = parseFrontmatter(readFileSync(wikiPage, 'utf-8'))
      return pageFm['source_sha'] !== gitHash(join(ROOT, src))
    })
  }

  // ── Build [[wikilinks]] from related: frontmatter field ──────────────────────

  function buildSeeAlso(fm, allSlugs) {
    const related = Array.isArray(fm['related']) ? fm['related'] : []
    const lines = []
    for (const r of related) {
      // r might be a path reference like 'docs/METHOD/FOO.md' or a bare slug
      const rSlug = r
        .toLowerCase()
        .replace(/[/\\._]/g, '-')
        .replace(/^docs-/, '')
      const match = [...allSlugs].find((s) => s.includes(rSlug.split('-').slice(0, 2).join('-')))
      if (match) lines.push(`- [[${match}]] — related`)
    }
    return lines.join('\n')
  }

  // ── Generate a single wiki page ───────────────────────────────────────────────

  function generatePage(sourcePath, allSlugs) {
    const absSource = join(ROOT, sourcePath)
    if (!existsSync(absSource)) return null
    const text = readFileSync(absSource, 'utf-8')
    const fm = parseFrontmatter(text)
    const title = (fm['title'] ?? sourcePath.replace(/^docs\//, '').replace(/\.md$/, '')).replace(
      /^'|'$/g,
      '',
    )
    const sha = gitHash(absSource)
    const today = new Date().toISOString().slice(0, 10)
    const seeAlso = buildSeeAlso(fm, allSlugs)

    // Strip frontmatter from content
    let content = text
    if (text.startsWith('---\n')) {
      const end = text.indexOf('\n---', 4)
      if (end !== -1) content = text.slice(end + 4).trimStart()
    }
    // Truncate very large docs to keep wiki pages readable
    if (content.length > 8000)
      content = content.slice(0, 8000) + '\n\n*[content truncated — see source for full text]*\n'

    const relSource = sourcePath.replace(/\\/g, '/')
    return (
      `---
generated: true
source: '${relSource}'
source_sha: '${sha}'
last_updated: '${today}'
---

# ${title}

> **Non-authoritative:** This page is compiled from source. On conflict, the SSOT source wins.
> Source: [${relSource}](../${relSource})

${content}
${seeAlso ? `## See Also\n\n${seeAlso}\n` : ''}`.trimEnd() + '\n'
    )
  }

  // ── --check mode: verify wiki/ is not stale ───────────────────────────────────

  if (isCheck) {
    if (!existsSync(WIKI_DIR)) {
      process.stdout.write(
        '  gen-wiki: wiki/ not found — run node scripts/gen-wiki.mjs to generate\n',
      )
      process.exit(1)
    }
    const sources = collectSourceDocs()
    const stale = staleSources(sources)
    for (const src of stale) {
      const slug = pageSlug(src)
      const wikiPage = join(WIKI_DIR, `${slug}.md`)
      if (!existsSync(wikiPage)) {
        process.stdout.write(`  gen-wiki --check: wiki/${slug}.md missing (source: ${src})\n`)
        continue
      }
      process.stdout.write(`  gen-wiki --check: wiki/${slug}.md is stale (source: ${src})\n`)
    }
    if (stale.length > 0) {
      process.stdout.write('  Run: node scripts/gen-wiki.mjs\n')
      process.exit(1)
    }
    const wikiFiles = readdirSync(WIKI_DIR).filter((f) => f.endsWith('.md') && f !== 'INDEX.md')
    process.stdout.write(`  gen-wiki: wiki/ is up to date (${wikiFiles.length + 1} pages)\n`)
    process.exit(0)
  }

  // ── query mode: keyword TF scoring ───────────────────────────────────────────

  if (isQuery) {
    if (!queryTerms) {
      process.stderr.write('Usage: node scripts/gen-wiki.mjs query <terms>\n')
      process.exit(1)
    }
    if (!existsSync(WIKI_DIR)) {
      process.stderr.write('wiki/ not found. Run gen-wiki.mjs build first.\n')
      process.exit(1)
    }
    const terms = queryTerms.toLowerCase().split(/\s+/).filter(Boolean)
    const results = []
    for (const file of readdirSync(WIKI_DIR).filter((f) => f.endsWith('.md'))) {
      const text = readFileSync(join(WIKI_DIR, file), 'utf-8').toLowerCase()
      const fm = parseFrontmatter(readFileSync(join(WIKI_DIR, file), 'utf-8'))
      let score = 0
      for (const term of terms) {
        const matches = [
          ...text.matchAll(new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')),
        ].length
        score += matches
      }
      if (score > 0) {
        results.push({ file, score, source: fm['source'] ?? '' })
      }
    }
    results.sort((a, b) => b.score - a.score)
    const top = results.slice(0, 5)
    if (top.length === 0) {
      process.stdout.write(`No wiki pages match "${queryTerms}"\n`)
    } else {
      process.stdout.write(`Top results for "${queryTerms}":\n`)
      for (const r of top) {
        process.stdout.write(`  ${r.file} (score: ${r.score}) — Source: ${r.source}\n`)
      }
    }
    process.exit(0)
  }

  // ── Build mode: generate wiki/ ────────────────────────────────────────────────

  mkdirSync(WIKI_DIR, { recursive: true })

  const sources = collectSourceDocs()
  const changedSources = isChanged ? new Set(staleSources(sources)) : null

  // Build slug map first (for cross-linking)
  const allSlugs = new Set(sources.map(pageSlug))

  const log = { generated_at: new Date().toISOString(), pages: [] }
  let generated = 0

  for (const src of sources) {
    if (changedSources && !changedSources.has(src)) continue
    const slug = pageSlug(src)
    const content = generatePage(src, allSlugs)
    if (!content) continue
    writeFileSync(join(WIKI_DIR, `${slug}.md`), content, 'utf-8')
    log.pages.push({ slug, source: src })
    generated++
  }

  // Generate wiki/INDEX.md
  const indexLines = [
    '---',
    'generated: true',
    "last_updated: '" + new Date().toISOString().slice(0, 10) + "'",
    '---',
    '',
    '# Wiki Index',
    '',
    "> Auto-generated from arbiter's SSOT-core documentation. Non-authoritative.",
    '',
  ]
  const sortedSlugs = [...allSlugs].sort()
  for (const s of sortedSlugs) {
    indexLines.push(`- [[${s}]]`)
  }
  writeFileSync(join(WIKI_DIR, 'INDEX.md'), indexLines.join('\n') + '\n', 'utf-8')

  // Write log (gitignored — contains timestamp)
  writeFileSync(join(WIKI_DIR, '.wiki-log.json'), JSON.stringify(log, null, 2) + '\n', 'utf-8')

  // ── Prune orphaned generator-owned pages (#2482) ────────────────────────────
  // wiki/ is gitignored, so a page whose source doc is gone (deleted, renamed,
  // or simply absent after a branch switch) would otherwise survive every
  // regeneration forever and later fail check-wiki-lint.mjs's citation check.
  //
  // Ownership, not a wiki/ sweep: only delete a page that generatePage() wrote
  // itself — identified by its own `generated: true` + `source: '<path>'`
  // frontmatter (the same fields check-wiki-lint.mjs already parses) — and
  // only when that source is no longer in the CURRENT FULL source set. A
  // hand-written file with no such frontmatter is never touched.
  //
  // Deliberately checked against `sources` (the full list), never against
  // `changedSources`: in --changed mode only the stale subset gets rewritten,
  // but every other current source is still valid and must not be pruned
  // just because this run didn't happen to touch it.
  const currentSources = new Set(sources)
  let pruned = 0
  for (const file of readdirSync(WIKI_DIR)) {
    if (!file.endsWith('.md') || file === 'INDEX.md') continue
    const absPage = join(WIKI_DIR, file)
    const pageFm = parseFrontmatter(readFileSync(absPage, 'utf-8'))
    if (pageFm['generated'] !== 'true') continue // not generator-owned
    const pageSource = pageFm['source']
    if (!pageSource || currentSources.has(pageSource)) continue // owned but still current
    rmSync(absPage)
    pruned++
  }

  process.stdout.write(
    `  gen-wiki: ${generated} page(s) written to wiki/ (${sources.length} source docs), ` +
      `${pruned} page(s) pruned\n`,
  )
  process.exit(0)
} catch (err) {
  process.stdout.write(`  gen-wiki: fatal — ${err instanceof Error ? err.message : String(err)}\n`)
  process.exit(1)
}
