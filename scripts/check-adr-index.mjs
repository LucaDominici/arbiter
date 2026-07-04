#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// CATALOG: Enforces docs/internal/ADR/ as the canonical ADR SSOT (INV-107, wave 2 migration).
// CATALOG: Rejected fold-in into check-doc-links.mjs because it enforces structural invariants, not link validity.
// CATALOG: Rejected fold-in into check-docs.mjs because it requires ADR-specific frontmatter parsing logic.
//
// INV-107: Verifies docs/internal/ADR/ is the canonical ADR SSOT:
//   1. Every numbered ADR file has canonical_id populated and matching its filename number.
//   2. No duplicate ADR numbers exist.
//   3. docs/internal/ADR/README.md lists every numbered ADR file.
// Usage: node scripts/check-adr-index.mjs [--adr-dir=path] [--readme=path]
// Exits 1 if any violations are found, 0 otherwise.
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'

const args = process.argv.slice(2)
const adrDirArg = args.find((a) => a.startsWith('--adr-dir='))
const readmeArg = args.find((a) => a.startsWith('--readme='))

const root = process.cwd()
const ADR_DIR = adrDirArg ? resolve(adrDirArg.split('=')[1]) : join(root, 'docs', 'internal', 'ADR')
const README_PATH = readmeArg
  ? resolve(readmeArg.split('=')[1])
  : join(root, 'docs', 'internal', 'ADR', 'README.md')

const NUMBERED_FILE_RE = /^(\d{3})-.+\.md$/

/** Parse YAML frontmatter between opening and closing --- delimiters. */
function parseFrontmatter(text) {
  const match = /^---\n([\s\S]*?)\n---/.exec(text)
  if (match === null) return {}
  const fm = {}
  for (const line of match[1].split('\n')) {
    const colon = line.indexOf(':')
    if (colon === -1) continue
    const key = line.slice(0, colon).trim()
    const raw = line.slice(colon + 1).trim()
    fm[key] = raw.replace(/^['"]|['"]$/g, '')
  }
  return fm
}

try {
  let violations = 0

  // ── Collect numbered ADR files ────────────────────────────────────────────

  if (!existsSync(ADR_DIR)) {
    process.stdout.write(`  ADR directory not found: ${ADR_DIR}\n`)
    process.exit(1)
  }

  const files = readdirSync(ADR_DIR).filter((f) => NUMBERED_FILE_RE.test(f))

  // ── Check 1: no duplicate numbers ─────────────────────────────────────────

  const numbersSeen = new Map()
  for (const file of files) {
    const num = file.slice(0, 3)
    if (numbersSeen.has(num)) {
      process.stdout.write(`  duplicate ADR number ${num}: ${numbersSeen.get(num)} and ${file}\n`)
      violations++
    } else {
      numbersSeen.set(num, file)
    }
  }

  // ── Check 2: canonical_id populated and matches filename number ────────────

  for (const file of files) {
    const num = file.slice(0, 3)
    const text = readFileSync(join(ADR_DIR, file), 'utf-8')
    const fm = parseFrontmatter(text)
    const id = fm['canonical_id'] ?? ''
    if (id === '' || id === null) {
      process.stdout.write(`  ${file}: canonical_id is empty\n`)
      violations++
    } else if (id !== num) {
      process.stdout.write(
        `  ${file}: canonical_id '${id}' does not match filename number '${num}'\n`,
      )
      violations++
    }
  }

  // ── Check 3: README lists every numbered ADR file ──────────────────────────

  if (!existsSync(README_PATH)) {
    process.stdout.write(`  README not found: ${README_PATH}\n`)
    violations++
  } else {
    const readmeText = readFileSync(README_PATH, 'utf-8')
    for (const file of files) {
      if (!readmeText.includes(file)) {
        process.stdout.write(`  README missing entry for ${file}\n`)
        violations++
      }
    }
  }

  // ── Result ─────────────────────────────────────────────────────────────────

  if (violations === 0) {
    process.stdout.write(`  check-adr-index: ${files.length} ADR files OK\n`)
    process.exit(0)
  } else {
    process.stdout.write(`  check-adr-index: ${violations} violation(s) found\n`)
    process.exit(1)
  }
} catch (err) {
  process.stdout.write(`  check-adr-index: fatal — ${err.message}\n`)
  process.exit(1)
}
