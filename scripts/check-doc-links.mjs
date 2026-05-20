#!/usr/bin/env node
// Gate: verify markdown links in docs/ resolve; follow CANONICAL_PATHS redirects. (INV-55, #255)
// Exits 0: all links resolve (possibly via redirect) or no docs found.
// Exits 1: one or more broken links with no valid redirect.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, dirname, resolve, relative, sep } from 'node:path'

const CWD = process.cwd()
const CANONICAL_PATHS_FILE = join(CWD, 'docs', 'METHOD', 'CANONICAL_PATHS.md')
const IGNORE_FILE = join(CWD, '.docs-links-ignore')

// Scan roots — extended in P6 to cover every hand-authored markdown tree
// (was: docs/ only). The walker skips dirs in SKIP_PATH_SEGMENTS.
// website/ is excluded: VitePress route paths (e.g. `/comparisons/spec-kit`)
// resolve via the site's router, not as relative file paths, so the
// file-existence check produces false positives. VitePress has its own
// build-time link verifier (`npm run docs:build`).
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
const SKIP_PATH_SEGMENTS = [
  `${sep}node_modules${sep}`,
  `${sep}dist${sep}`,
  `${sep}.git${sep}`,
  `${sep}.changeset${sep}`,
  `${sep}api${sep}`,
  `${sep}.coverage-tmp${sep}`,
  `${sep}.evidence${sep}`,
  `${sep}report${sep}`,
  `${sep}internal${sep}`,
]

const ignored = new Set()
if (existsSync(IGNORE_FILE)) {
  readFileSync(IGNORE_FILE, 'utf-8')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .forEach((p) => ignored.add(p))
}

function loadAliases() {
  const aliases = new Map()
  if (!existsSync(CANONICAL_PATHS_FILE)) return aliases
  const lines = readFileSync(CANONICAL_PATHS_FILE, 'utf-8').split('\n')
  for (const line of lines) {
    const m = line.match(/\|\s*`([^`]+)`\s*\|\s*`([^`]+)`/)
    if (m) aliases.set(m[1], m[2])
  }
  return aliases
}

function shouldSkip(absPath) {
  return SKIP_PATH_SEGMENTS.some((seg) => absPath.includes(seg))
}

function findMarkdownFiles(dir) {
  const files = []
  if (!existsSync(dir)) return files
  if (shouldSkip(dir + sep)) return files
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (shouldSkip(full + sep)) continue
      files.push(...findMarkdownFiles(full))
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      files.push(full)
    }
  }
  return files
}

function collectScanFiles() {
  const out = []
  for (const r of SCAN_ROOTS) {
    out.push(...findMarkdownFiles(join(CWD, r)))
  }
  for (const f of ROOT_FILES) {
    const abs = join(CWD, f)
    if (existsSync(abs) && statSync(abs).isFile()) out.push(abs)
  }
  return out
}

function isLocal(href) {
  return (
    !href.startsWith('http://') &&
    !href.startsWith('https://') &&
    !href.startsWith('#') &&
    !href.startsWith('mailto:')
  )
}

const aliases = loadAliases()
const markdownFiles = collectScanFiles()

if (markdownFiles.length === 0) {
  process.stdout.write('  check-doc-links: no docs found — skipping\n')
  process.exit(0)
}

// Extract [text](href) links from markdown
const LINK_PATTERN = /\[([^\]]*)\]\(([^)]+)\)/g
let broken = 0

function stripCodeSpansAndBlocks(text) {
  // Remove fenced code blocks first (```...```), then inline code spans (`...`).
  const noFences = text.replace(/```[\s\S]*?```/g, '')
  return noFences.replace(/`[^`\n]*`/g, '')
}

for (const file of markdownFiles) {
  const raw = readFileSync(file, 'utf-8')
  const content = stripCodeSpansAndBlocks(raw)
  const fileDir = dirname(file)
  for (const linkMatch of content.matchAll(LINK_PATTERN)) {
    const href = linkMatch[2].split('#')[0]
    if (!href || !isLocal(href)) continue

    const absTarget = resolve(fileDir, href)
    const relTarget = relative(CWD, absTarget)

    if (ignored.has(relTarget)) continue
    if (existsSync(absTarget)) continue

    const redirectTarget = aliases.get(relTarget)
    if (redirectTarget) {
      const absRedirect = join(CWD, redirectTarget)
      if (existsSync(absRedirect)) continue
      const srcRel = relative(CWD, file)
      process.stdout
        .write(`  broken: ${srcRel}: ${relTarget} → redirect ${redirectTarget} also missing
`)
    } else {
      const srcRel = relative(CWD, file)
      process.stdout.write(`  broken: ${srcRel}: ${relTarget}
`)
    }
    broken++
  }
}

if (broken === 0) {
  process.stdout.write(`  check-doc-links: all links resolve (${markdownFiles.length} files scanned)
`)
  process.exit(0)
}

process.stdout.write(`\n  check-doc-links: ${broken} broken link(s) found
`)
process.exit(1)
