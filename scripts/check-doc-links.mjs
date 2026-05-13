#!/usr/bin/env node
// Gate: verify markdown links in docs/ resolve; follow CANONICAL_PATHS redirects. (INV-55, #255)
// Exits 0: all links resolve (possibly via redirect) or no docs found.
// Exits 1: one or more broken links with no valid redirect.
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, dirname, resolve, relative } from 'node:path'

const CWD = process.cwd()
const CANONICAL_PATHS_FILE = join(CWD, 'docs', 'METHOD', 'CANONICAL_PATHS.md')
const IGNORE_FILE = join(CWD, '.docs-links-ignore')
const DOCS_DIR = join(CWD, 'docs')

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

function findMarkdownFiles(dir) {
  const files = []
  if (!existsSync(dir)) return files
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...findMarkdownFiles(full))
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      files.push(full)
    }
  }
  return files
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
const markdownFiles = findMarkdownFiles(DOCS_DIR)

if (markdownFiles.length === 0) {
  console.log('  check-doc-links: no docs found — skipping')
  process.exit(0)
}

// Extract [text](href) links from markdown
const LINK_PATTERN = /\[([^\]]*)\]\(([^)]+)\)/g
let broken = 0

for (const file of markdownFiles) {
  const content = readFileSync(file, 'utf-8')
  const fileDir = dirname(file)
  let linkMatch
  LINK_PATTERN.lastIndex = 0
  while ((linkMatch = LINK_PATTERN.exec(content)) !== null) {
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
      console.log(`  broken: ${srcRel}: ${relTarget} → redirect ${redirectTarget} also missing`)
    } else {
      const srcRel = relative(CWD, file)
      console.log(`  broken: ${srcRel}: ${relTarget}`)
    }
    broken++
  }
}

if (broken === 0) {
  console.log(`  check-doc-links: all links resolve (${markdownFiles.length} files scanned)`)
  process.exit(0)
}

console.log(`\n  check-doc-links: ${broken} broken link(s) found`)
process.exit(1)
